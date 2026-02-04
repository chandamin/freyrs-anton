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
  Badge,
  Thumbnail,
  BlockStack,
  Button,
  ButtonGroup,
  Card,
  InlineStack,
  Icon,
  Box,
  Tooltip,
  EmptyState,
  Banner,
  InlineGrid
} from "@shopify/polaris";
import { SearchIcon, EditIcon, PackageIcon } from "@shopify/polaris-icons";
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
  const { smDown } = useBreakpoints();

  const [rows, setRows] = useState(loaderRows);
  const [query, setQuery] = useState("");
  const [loadingRowId, setLoadingRowId] = useState(null);
  const [toast, setToast] = useState(null);
  const [activeDrawer, setActiveDrawer] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const [activeTab, setActiveTab] = useState("details");
  const [editingRowId, setEditingRowId] = useState(null);

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

  // Calculate inventory stats
  const stats = useMemo(() => {
    const total = filteredRows.reduce((sum, row) => sum + row.onHand, 0);
    const incoming = filteredRows.reduce((sum, row) => sum + row.incoming, 0);
    const lowStock = filteredRows.filter(row => row.onHand < 10).length;
    
    return { total, incoming, lowStock };
  }, [filteredRows]);

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

      setToast({ content: "✓ Inventory updated successfully", error: false });
    } catch {
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, onHand: original.onHand } : r
        )
      );
      setToast({ content: "✗ Update failed. Please try again.", error: true });
    } finally {
      setLoadingRowId(null);
      setEditingRowId(null);
    }
  };

  const openDrawer = (row) => {
    setActiveItem(row);
    setActiveTab("details");
    setActiveDrawer(true);
  };

  const getStockStatus = (quantity) => {
    if (quantity === 0) return { status: "critical", label: "Out of stock" };
    if (quantity < 10) return { status: "warning", label: "Low stock" };
    if (quantity < 50) return { status: "attention", label: "Medium stock" };
    return { status: "success", label: "In stock" };
  };

  const { selectedResources, handleSelectionChange } =
    useIndexResourceState(filteredRows);

  return (
    <Frame>
      <Page 
        title="Inventory Management"
        subtitle="Manage your product inventory and stock levels"
      >
        {/* Stats Cards */}
        <Box paddingBlockEnd="400">
          <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" as="p" tone="subdued">
                    Total Units
                  </Text>
                  <Icon source={PackageIcon} tone="base" />
                </InlineStack>
                <Text variant="heading2xl" as="h3">
                  {stats.total.toLocaleString()}
                </Text>
              </BlockStack>
            </Card>
            
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" as="p" tone="subdued">
                    Incoming Stock
                  </Text>
                  <Badge tone="info">Pending</Badge>
                </InlineStack>
                <Text variant="heading2xl" as="h3">
                  {stats.incoming.toLocaleString()}
                </Text>
              </BlockStack>
            </Card>
            
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" as="p" tone="subdued">
                    Low Stock Items
                  </Text>
                  <Badge tone={stats.lowStock > 0 ? "warning" : "success"}>
                    {stats.lowStock > 0 ? "Attention" : "All good"}
                  </Badge>
                </InlineStack>
                <Text variant="heading2xl" as="h3">
                  {stats.lowStock}
                </Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Box>

        {/* Main Table Card */}
        <LegacyCard>
          {/* Search Bar */}
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <TextField
              placeholder="Search by product name or SKU..."
              value={query}
              onChange={setQuery}
              autoComplete="off"
              prefix={<Icon source={SearchIcon} tone="base" />}
              clearButton
              onClearButtonClick={() => setQuery("")}
            />
          </Box>

          {/* Results Summary */}
          {query && (
            <Box padding="400" background="bg-surface-secondary">
              <Text as="p" variant="bodySm" tone="subdued">
                Found {filteredRows.length} {filteredRows.length === 1 ? 'variant' : 'variants'} matching "{query}"
              </Text>
            </Box>
          )}

          {/* Table */}
          {filteredRows.length === 0 ? (
            <Box padding="1600">
              <EmptyState
                heading="No variants found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Try adjusting your search to find what you're looking for.</p>
              </EmptyState>
            </Box>
          ) : (
            <IndexTable
              condensed={smDown}
              resourceName={{ singular: "variant", plural: "variants" }}
              itemCount={filteredRows.length}
              selectedItemsCount={selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Product" },
                { title: "SKU" },
                { title: "Stock Status" },
                { title: "On Hand" },
                { title: "Incoming" },
                { title: "To Order" },
                { title: "Actions" },
              ]}
            >
              {filteredRows.map((row, index) => {
                const stockStatus = getStockStatus(row.onHand);
                const isEditing = editingRowId === row.id;
                const isLoading = loadingRowId === row.id;

                return (
                  <IndexTable.Row
                    id={row.id}
                    key={row.id}
                    position={index}
                    selected={selectedResources.includes(row.id)}
                  >
                    {/* Product with Thumbnail */}
                    <IndexTable.Cell>
                      <InlineStack gap="300" blockAlign="center">
                        <Thumbnail
                          source={row.image || ""}
                          alt={row.productTitle}
                          size="small"
                        />
                        <div style={{ maxWidth: 200 }}>
                          <Text 
                            variant="bodyMd" 
                            fontWeight="semibold" 
                            as="span"
                            truncate="20"
                          >
                            {row.productTitle}
                          </Text>
                        </div>
                      </InlineStack>
                    </IndexTable.Cell>

                    {/* SKU */}
                    <IndexTable.Cell>
                      <Text variant="bodyMd" as="span" tone="subdued">
                        {row.sku}
                      </Text>
                    </IndexTable.Cell>

                    {/* Stock Status Badge */}
                    <IndexTable.Cell>
                      <Badge tone={stockStatus.status}>
                        {stockStatus.label}
                      </Badge>
                    </IndexTable.Cell>

                    {/* On Hand (Editable) */}
                    <IndexTable.Cell>
                      <div
                        style={{ position: "relative", width: 100 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <TextField
                          labelHidden
                          type="number"
                          value={String(row.onHand)}
                          disabled={isLoading}
                          onChange={(value) => {
                            updateValue(row.id, "onHand", value);
                            setEditingRowId(row.id);
                          }}
                          onBlur={() => submitInventoryUpdate(row)}
                          onFocus={() => setEditingRowId(row.id)}
                          autoComplete="off"
                        />
                        {isLoading && (
                          <div style={{ 
                            position: "absolute", 
                            right: 8, 
                            top: "50%", 
                            transform: "translateY(-50%)" 
                          }}>
                            <Spinner size="small" />
                          </div>
                        )}
                      </div>
                    </IndexTable.Cell>

                    {/* Incoming */}
                    <IndexTable.Cell>
                      <Box 
                        padding="200" 
                        background="bg-surface-secondary" 
                        borderRadius="100"
                      >
                        <Text variant="bodyMd" as="span" alignment="center">
                          {row.incoming}
                        </Text>
                      </Box>
                    </IndexTable.Cell>

                    {/* To Order */}
                    <IndexTable.Cell>
                      <div
                        style={{ width: 100 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <TextField
                          labelHidden
                          type="number"
                          value={String(row.toOrder)}
                          onChange={(value) =>
                            updateValue(row.id, "toOrder", value)
                          }
                          autoComplete="off"
                        />
                      </div>
                    </IndexTable.Cell>

                    {/* Actions */}
                    <IndexTable.Cell>
                      <Button
                        size="slim"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDrawer(row);
                        }}
                        icon={EditIcon}
                      >
                        Details
                      </Button>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>
          )}

          {/* Pagination */}
          <Box 
            padding="400" 
            borderBlockStartWidth="025" 
            borderColor="border"
          >
            <InlineStack align="center">
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
            </InlineStack>
          </Box>
        </LegacyCard>

        {/* Toast Notifications */}
        {toast && (
          <Toast
            content={toast.content}
            error={toast.error}
            onDismiss={() => setToast(null)}
            duration={3000}
          />
        )}

        {/* Drawer */}
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