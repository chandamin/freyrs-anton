import {
  IndexTable,
  LegacyCard,
  Text,
  TextField,
  useIndexResourceState,
  useBreakpoints,
  Page,
  Pagination,
  Spinner,
  Toast,
  Frame,
  Modal,
  Thumbnail,
  BlockStack,
  MediaCard,
  Button,
  ButtonGroup,
  Card,
  InlineStack,
  List,
  Image,
  Box,
  Divider,
  DataTable
} from "@shopify/polaris";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useSearchParams,
  useFetcher,
} from "@remix-run/react";
import { useState, useMemo, useEffect } from "react";
import { authenticate } from "../shopify.server";
import InventoryDrawer from "./components/InventoryDrawer";


/* =========================
   LOADER
   ========================= */
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");

  const PRODUCTS_PER_PAGE = 10;

  const response = await admin.graphql(
    `
    query ($first: Int, $last: Int, $after: String, $before: String) {
      products(first: $first, last: $last, after: $after, before: $before) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        edges {
          node {
            title
            featuredImage {
              url
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                  inventoryItem {
                    id
                    inventoryLevels(first: 1) {
                      edges {
                        node {
                          location {
                            id
                          }
                          quantities(names: ["available", "incoming"]) {
                            name
                            quantity
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `,
    {
      variables: {
        first: before ? null : PRODUCTS_PER_PAGE,
        last: before ? PRODUCTS_PER_PAGE : null,
        after,
        before,
      },
    }
  );

  const result = await response.json();
  const products = result.data.products;

  const rows = [];

  products.edges.forEach((productEdge) => {
    productEdge.node.variants.edges.forEach((variantEdge) => {
      const inventoryLevel =
        variantEdge.node.inventoryItem?.inventoryLevels?.edges?.[0]?.node;

      const quantities = inventoryLevel?.quantities || [];

      rows.push({
        id: variantEdge.node.id,
        inventoryItemId: variantEdge.node.inventoryItem.id,
        locationId: inventoryLevel?.location?.id,
        productTitle: productEdge.node.title,
        sku: variantEdge.node.sku || "-",
        image: productEdge.node.featuredImage?.url,
        onHand:
          quantities.find((q) => q.name === "available")?.quantity || 0,
        incoming:
          quantities.find((q) => q.name === "incoming")?.quantity || 0,
        toOrder: 0,
      });
    });
  });

  return json({
    rows,
    pageInfo: products.pageInfo,
  });
}

/* =========================
   ACTION
   ========================= */
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const { inventoryItemId, locationId, delta } =
    await request.json();

  if (!inventoryItemId || !locationId || typeof delta !== "number") {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const response = await admin.graphql(
    `
    mutation inventoryAdjust($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        userErrors {
          field
          message
        }
      }
    }
  `,
    {
      variables: {
        input: {
          name: "available",
          reason: "correction",
          changes: [{ inventoryItemId, locationId, delta }],
        },
      },
    }
  );

  const result = await response.json();
  const errors =
    result?.data?.inventoryAdjustQuantities?.userErrors || [];

  if (errors.length) {
    return json({ errors }, { status: 400 });
  }

  return json({ success: true });
}

/* =========================
   COMPONENT
   ========================= */
export default function InventoryTable() {
  const { rows: loaderRows, pageInfo } = useLoaderData();
  const [, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();

  const [rows, setRows] = useState(loaderRows);
  const [query, setQuery] = useState("");
  const [loadingRowId, setLoadingRowId] = useState(null);
  const [toast, setToast] = useState(null);

  // Modal state
const [activeDrawer, setActiveDrawer] = useState(false);
const [activeItem, setActiveItem] = useState(null);
const [activeTab, setActiveTab] = useState("details");



  useEffect(() => {
    setRows(loaderRows);
  }, [loaderRows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) =>
      `${row.productTitle} ${row.sku}`
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  }, [rows, query]);

  const updateValue = (id, field, value) => {
    const num = Math.max(0, Number(value) || 0);
    setRows((prev) =>
      prev.map((row) =>
        row.id === id ? { ...row, [field]: num } : row
      )
    );
  };

  const submitInventoryUpdate = async (row) => {
    const original = loaderRows.find((r) => r.id === row.id);
    if (!original) return;

    const delta = row.onHand - original.onHand;
    if (delta === 0) return;

    setLoadingRowId(row.id);

    try {
      fetcher.submit(
        JSON.stringify({
          inventoryItemId: row.inventoryItemId,
          locationId: row.locationId,
          delta,
        }),
        { method: "post", encType: "application/json" }
      );

      setToast({ content: "Inventory updated", error: false });
    } catch {
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, onHand: original.onHand } : r
        )
      );
      setToast({ content: "Update failed", error: true });
    } finally {
      setLoadingRowId(null);
    }
  };

 const openDrawer = (row) => {
  setActiveItem(row);
  setActiveTab("details");
  setActiveDrawer(true);
};

  const { selectedResources, handleSelectionChange } =
    useIndexResourceState(filteredRows);

  return (
    <Frame>
      <Page title="Inventory (Variants)">
        <LegacyCard>
          <div style={{ padding: 16 }}>
            <TextField
              placeholder="Search by product or SKU"
              value={query}
              onChange={setQuery}
              autoComplete="off"
            />
          </div>

          <IndexTable
            condensed={useBreakpoints().smDown}
            resourceName={{ singular: "variant", plural: "variants" }}
            itemCount={filteredRows.length}
            selectedItemsCount={selectedResources.length}
            onSelectionChange={handleSelectionChange}
            headings={[
              { title: "Product" },
              { title: "SKU" },
              { title: "On hand" },
              { title: "Incoming" },
              { title: "To order" },
            ]}
          >
            {filteredRows.map((row, index) => (
              <IndexTable.Row
                id={row.id}
                key={row.id}
                position={index}
                selected={selectedResources.includes(row.id)}
                onClick={() => {}}
              >
                {/* Product title (clickable) */}
                <IndexTable.Cell>
                  <div
                    style={{ position: "relative", width: 200 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      openDrawer(row);
                    }}
                  >
                  <Text>
                    {row.productTitle}
                  </Text>
                  </div>
                </IndexTable.Cell>

                <IndexTable.Cell>{row.sku}</IndexTable.Cell>

                <IndexTable.Cell>
                  <div
                    style={{ position: "relative", width: 90 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <TextField
                      labelHidden
                      type="number"
                      value={String(row.onHand)}
                      disabled={loadingRowId === row.id}
                      onChange={(value) =>
                        updateValue(row.id, "onHand", value)
                      }
                      onBlur={() => submitInventoryUpdate(row)}
                    />
                    {loadingRowId === row.id && (
                      <Spinner size="small" />
                    )}
                  </div>
                </IndexTable.Cell>

                <IndexTable.Cell>
                  <TextField
                    labelHidden
                    type="number"
                    value={String(row.incoming)}
                    disabled
                  />
                </IndexTable.Cell>

                <IndexTable.Cell>
                  <TextField
                    labelHidden
                    type="number"
                    value={String(row.toOrder)}
                    onChange={(value) =>
                      updateValue(row.id, "toOrder", value)
                    }
                  />
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>

          <div style={{ padding: 16, display: "flex", justifyContent: "center" }}>
            <Pagination
              hasPrevious={pageInfo.hasPreviousPage}
              onPrevious={() =>
                setSearchParams({ before: pageInfo.startCursor })
              }
              hasNext={pageInfo.hasNextPage}
              onNext={() =>
                setSearchParams({ after: pageInfo.endCursor })
              }
            />
          </div>
        </LegacyCard>

        {toast && (
          <Toast
            content={toast.content}
            error={toast.error}
            onDismiss={() => setToast(null)}
          />
        )}
<InventoryDrawer
  open={activeDrawer}
  item={activeItem}
  activeTab={activeTab}
  setActiveTab={setActiveTab}
  onClose={() => setActiveDrawer(false)}
/>


      </Page>
    </Frame>
  );
}
