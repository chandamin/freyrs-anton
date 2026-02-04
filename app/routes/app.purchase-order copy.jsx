import {
  Page,
  Card,
  Layout,
  TextField,
  Button,
  InlineStack,
  BlockStack,
  DataTable,
  Text,
  Toast,
  Frame,
  Spinner,
  DropZone,
  Modal,
  InlineGrid,
  Box
} from "@shopify/polaris";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import fs from "fs";



/* =========================
   LOADER (SEARCH VARIANTS)
   ========================= */
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("query");

  // 🚫 HARD BLOCK — prevent Shopify returning all products
  if (!query || query.trim().length < 2) {
    return json({ variants: [], blocked: true });
  }

  const response = await admin.graphql(
    `
    query ($query: String!) {
      products(first: 20, query: $query) {
        edges {
          node {
            variants(first: 20) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  product {
                    title
                  }
                }
              }
            }
          }
        }
      }
    }
    `,
    { variables: { query } }
  );

  const data = await response.json();

  const variants =
    data?.data?.products?.edges?.flatMap((p) =>
      p.node.variants.edges.map((v) => v.node)
    ) || [];

  return json({ variants, blocked: false });
}

export async function action({ request }) {
  const formData = await request.formData();

  const intent = formData.get("intent");

if (intent === "create_product") {
  const title = formData.get("title");
  const sku = formData.get("sku");
  const price = Number(formData.get("price"));
  const quantity = Number(formData.get("quantity"));

  const { admin } = await authenticate.admin(request);

  // 🔹 GET LOCATION DYNAMICALLY
  const locationResponse = await admin.graphql(`
    query {
      locations(first: 1) {
        nodes {
          id
        }
      }
    }
  `);

  const locationData = await locationResponse.json();
  const locationId = locationData?.data?.locations?.nodes?.[0]?.id;

  if (!locationId) {
    return json({ error: "No active Shopify location found" });
  }

  // 🔹 CREATE PRODUCT
  const response = await admin.graphql(
    `
    mutation CreateSimpleProduct($productSet: ProductSetInput!, $synchronous: Boolean!) {
      productSet(synchronous: $synchronous, input: $productSet) {
        product {
          id
          title
          variants(first: 1) {
            nodes {
              id
              title
              sku
              price
              inventoryQuantity
            }
          }
        }
        userErrors {
          message
        }
      }
    }
    `,
    {
      variables: {
        synchronous: true,
        productSet: {
          title,
          productOptions: [
            {
              name: "Title",
              position: 1,
              values: [{ name: "Default" }],
            },
          ],
          variants: [
            {
              optionValues: [
                { optionName: "Title", name: "Default" },
              ],
              sku,
              price,
              inventoryQuantities: [
                {
                  locationId,
                  name: "available",
                  quantity,
                },
              ],
            },
          ],
        },
      },
    }
  );

  const data = await response.json();

  const errors = data?.data?.productSet?.userErrors;
  if (errors?.length) {
    return json({ error: errors[0].message });
  }

  const variant =
    data.data.productSet.product.variants.nodes[0];

  return json({
    success: true,
    createdVariant: variant,
  });
}




  const attachmentFile = formData.get("attachment");
  const poNumber = formData.get("poNumber");
  const vendor = formData.get("vendor");
  const readyDate = formData.get("readyDate");
  const note = formData.get("note") || null;
  const items = JSON.parse(formData.get("items") || "[]");
  const payAmount = Number(formData.get("payAmount") || 0);

  /* ================= VALIDATION ================= */
  if (!poNumber || !vendor || !readyDate || items.length === 0) {
    return json(
      { error: "Required purchase order fields missing" },
      { status: 400 }
    );
  }

  /* ================= FILE UPLOAD ================= */
  let attachmentPath = null;

  if (attachmentFile && typeof attachmentFile === "object") {
    const buffer = Buffer.from(await attachmentFile.arrayBuffer());

    const uploadDir = "public/uploads";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = `${uploadDir}/${Date.now()}-${attachmentFile.name}`;
    fs.writeFileSync(filePath, buffer);

    attachmentPath = filePath.replace("public", "");
  }

  /* ================= TOTALS ================= */
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
  const totalAmount = items.reduce(
    (s, i) => s + i.quantity * i.cost,
    0
  );

  /* ================= FIND EXISTING PO ================= */
  let po = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
    include: { payments: true, items: true },
  });


 /* ================= CREATE PO IF NOT EXISTS ================= */
if (!po) {
  po = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      vendor,
      readyDate: new Date(readyDate),
      note,
      attachment: attachmentPath,
      totalUnits,
      totalAmount,
      status: "PENDING",
      items: {
        create: items.map((i) => ({
          variantId: i.id,
          title: i.title,
          sku: i.sku,
          quantity: i.quantity,
          cost: i.cost,
          subtotal: i.quantity * i.cost,
        })),
      },
    },
    include: { payments: true, items: true },
  });
} else {
  // 🚫 PO already exists & user clicked "Create Order"
  if (intent === "create_order") {
    return json({
      error:
        "Purchase order already exists. Use Submit Payment to add a payment.",
    });
  }
}


  /* ================= ADD PAYMENT (OPTIONAL) ================= */
  if (intent === "submit_payment" && payAmount > 0) {
    await prisma.payment.create({
      data: {
        purchaseOrderId: po.id,
        amount: payAmount,
      },
    });
  }

  /* ================= RECALCULATE STATUS ================= */
  const totalPaid =
    (po.payments?.reduce((s, p) => s + p.amount, 0) || 0) +
    (payAmount > 0 && intent === "submit_payment" ? payAmount : 0);

  let status = "PENDING";

  if (totalPaid >= totalAmount) {
    status = "COMPLETED";
  } else if (totalPaid > 0) {
    status = "IN_PROGRESS";
  }

  await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { status },
  });

  return json({
    success: true,
    message:
      intent === "submit_payment"
        ? "Purchase order saved with payment"
        : "Purchase order created",
  });
}




/* =========================
   COMPONENT
   ========================= */
export default function PurchaseOrder() {
  const fetcher = useFetcher();

  /* ---- PO details ---- */
  const [poNumber, setPoNumber] = useState("#PO");
  const [vendor, setVendor] = useState("");
  const [readyDate, setReadyDate] = useState("");
  const [note, setNote] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [attachment, setAttachment] = useState(null);

  /* ---- Search ---- */
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [activeQuery, setActiveQuery] = useState("");

  /* ---- PO Items ---- */
  const [items, setItems] = useState([]);

  /* ---- Toast ---- */
const [toast, setToast] = useState({
  show: false,
  message: "",
  error: false,
});

const [showCreateModal, setShowCreateModal] = useState(false);

const [newProduct, setNewProduct] = useState({
  title: "",
  sku: "",
  price: "",
  quantity: "",
});



  /* ================= APPLY FETCHER RESULT (SAFE) ================= */
useEffect(() => {
  if (
    fetcher.state !== "idle" ||
    !fetcher.data ||
    fetcher.data.blocked ||
    !search ||
    search.trim().length < 2 ||
    activeQuery !== search ||
    !Array.isArray(fetcher.data.variants)
  ) {
    return;
  }

  setResults(fetcher.data.variants);
}, [fetcher.data, fetcher.state, activeQuery, search]);


  /* ================= REAL-TIME SEARCH ================= */
  useEffect(() => {
    // 🧹 Clear immediately on delete
    if (!search.trim()) {
      setResults([]);
      setActiveQuery("");
      return;
    }

    if (search.trim().length < 2) {
      setResults([]);
      return;
    }

    if (search === activeQuery) return;

    const timeout = setTimeout(() => {
      setActiveQuery(search);
      setResults([]);
      fetcher.submit(
        { query: search },
        { method: "get", action: "." }
      );
    }, 400);

    return () => clearTimeout(timeout);
  }, [search]);

useEffect(() => {
  if (!fetcher.data) return;

  /* ===== EXISTING BEHAVIOR (UNCHANGED) ===== */
  if (fetcher.data.success && fetcher.data.message) {
    setToast({
      show: true,
      message: fetcher.data.message,
      error: false,
    });
  }

  if (fetcher.data.error) {
    setToast({
      show: true,
      message: fetcher.data.error,
      error: true,
    });
  }

  /* ===== NEW: CREATE PRODUCT FLOW ===== */
  if (fetcher.data.createdVariant) {
    addVariant({
      id: fetcher.data.createdVariant.id,
      title: fetcher.data.createdVariant.title,
      sku: fetcher.data.createdVariant.sku,
      cost: Number(fetcher.data.createdVariant.price),
      quantity: 1,
      product: { title: fetcher.data.createdVariant.title },
    });

    setShowCreateModal(false);
    setNewProduct({
      title: "",
      sku: "",
      price: "",
      quantity: "",
    });

    setToast({
      show: true,
      message: "Product created and added to purchase order",
      error: false,
    });
  }
}, [fetcher.data]);



  /* ================= ADD VARIANT ================= */
  const addVariant = (variant) => {
  if (items.find((i) => i.id === variant.id)) {
    setToast({
      show: true,
      message: "Variant already added",
      error: true, // 🔴 RED toast
    });
    return;
  }

  setItems((prev) => [
    ...prev,
    {
      id: variant.id,
      title: `${variant.product.title} — ${variant.title}`,
      sku: variant.sku || "-",
      quantity: 1,
      cost: Number(variant.price || 0),
    },
  ]);

  setToast({
    show: true,
    message: "Variant added to purchase order",
    error: false, // 🟢 normal toast
  });
};


  /* ================= TOTALS ================= */
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
  const totalAmount = items.reduce(
    (s, i) => s + i.quantity * i.cost,
    0
  );

  return (
    <Frame>
      <Page title="Create Purchase Order">
        <Layout>

          {/* ================= PO DETAILS ================= */}
          <Layout.Section>
            <Card>
              {/* <InlineStack gap="400"> */}
              <InlineGrid columns={3} gap={400}>
                <TextField label="Purchase Order" value={poNumber}  onChange={(value) => {
    if (!value.startsWith("#PO")) {
      setPoNumber("#PO");
    } else {
      setPoNumber(value);
    }
  }} />
                <TextField label="Vendor" value={vendor} onChange={setVendor} placeholder="Enter Vendor Name" />
                <TextField label="Ready Date" type="date" value={readyDate} onChange={setReadyDate} />
                </InlineGrid>
              {/* </InlineStack> */}
            </Card>
          </Layout.Section>

          {/* ================= SEARCH ================= */}
         <Layout.Section>
<Card>
  <InlineStack gap="400" align="space-between" blockAlign="end">
    <Box minWidth="300px" style={{ flex: 1 }}>
      <TextField
        label="Search products"
        placeholder="Title, Vendor OR SKU"
        value={search}
        onChange={setSearch}
        autoComplete="off"
      />
    </Box>
    <Button onClick={() => setShowCreateModal(true)} variant="primary">
      Create Product
    </Button>
  </InlineStack>
</Card>
</Layout.Section>


          {/* ================= LOADER ================= */}
          {fetcher.state === "loading" && (
            <Layout.Section>
              <Card>
                <InlineStack align="center">
                  <Spinner size="small" />
                  <Text>Searching products…</Text>
                </InlineStack>
              </Card>
            </Layout.Section>
          )}

          {/* ================= SEARCH RESULTS ================= */}
          {fetcher.state === "idle" && results.length > 0 && (
            <Layout.Section>
              <Card title="Search Results">
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "text"]}
                  headings={["Variant", "SKU", "Price", ""]}
                  rows={results.map((v) => [
                    `${v.product.title} — ${v.title}`,
                    v.sku || "-",
                    `$${v.price}`,
                    <Button size="slim" onClick={() => addVariant(v)}>Add</Button>,
                  ])}
                />
              </Card>
            </Layout.Section>
          )}

          {/* ================= NO RESULTS ================= */}
          {fetcher.state === "idle" &&
            search.trim().length >= 2 &&
            results.length === 0 && (
              <Layout.Section>
                <Card>
                  <Text tone="subdued">No products found</Text>
                </Card>
              </Layout.Section>
            )}

          {/* ================= PO ITEMS ================= */}
          <Layout.Section>
            <Card>
              <DataTable
                columnContentTypes={[
                  "text",
                  "numeric",
                  "numeric",
                  "text",
                  "numeric",
                  "text",
                ]}
                headings={[
                  "Variant",
                  "Quantity",
                  "Cost",
                  "SKU",
                  "Subtotal",
                  "Action",
                ]}
                rows={
                  items.length === 0
                    ? [[
                        <Text tone="subdued">No items added</Text>,
                        "",
                        "",
                        "",
                        "",
                        "",
                      ]]
                    : items.map((item, index) => [
                        item.title,
                        <TextField
                          type="number"
                          value={String(item.quantity)}
                          onChange={(val) => {
                            const next = [...items];
                            next[index].quantity = Number(val);
                            setItems(next);
                          }}
                        />,
                        <TextField
                          type="number"
                          value={String(item.cost)}
                          onChange={(val) => {
                            const next = [...items];
                            next[index].cost = Number(val);
                            setItems(next);
                          }}
                        />,
                        item.sku,
                        `$${(item.quantity * item.cost).toFixed(2)}`,
                        <Button
                          tone="critical"
                          onClick={() =>
                            setItems(items.filter((_, i) => i !== index))
                          }
                        >
                          Remove
                        </Button>,
                      ])
                }
              />
            </Card>
          </Layout.Section>

          {/* ================= NOTE + SUMMARY ================= */}
          <Layout.Section>
            <Layout>
              <Layout.Section variant="oneHalf">
                <Card title="Note" gap="200">
                  <Text as="h3" variant="headingSm" gap="200">
                    Note
                  </Text>

                  <TextField
                    multiline={6}
                    value={note}
                    onChange={setNote}
                    placeholder="Enter your note here"
                    autoComplete="off"
                  />
                   <DropZone
                      label="Attachment"
                      allowMultiple={false}
                      onDrop={(_dropFiles, acceptedFiles) => {
                        setAttachment(acceptedFiles[0]);
                      }}
                    >
                      <DropZone.FileUpload />
                    </DropZone>

                    {attachment && (
                      <Text tone="subdued">
                        Selected file: {attachment.name}
                      </Text>
                    )}

                </Card>
                   
              </Layout.Section>

              <Layout.Section variant="oneHalf">
                <Card title="Purchase Order">
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text>Total Units</Text>
                      <Text>{totalUnits}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text>Total</Text>
                      <Text>${totalAmount.toFixed(2)}</Text>
                    </InlineStack>
                    <TextField
                    placeholder="Enter Amount to Pay"
                      label="Pay"
                      type="number"
                      value={String(payAmount)}
                      onChange={setPayAmount}
                    />
                    <InlineStack align="space-between">
                      <Text>Balance</Text>
                      <Text>
                        ${(totalAmount - (payAmount || 0)).toFixed(2)}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                   <BlockStack gap="200">
                            <InlineStack align="space-between">
                        <Button
                          disabled={fetcher.state !== "idle"}
                          onClick={() =>
                          {
                            const formData = new FormData();

                      formData.append("intent", "create_order");
                      formData.append("poNumber", poNumber);
                      formData.append("vendor", vendor);
                      formData.append("readyDate", readyDate);
                      formData.append("note", note);
                      formData.append("items", JSON.stringify(items));

                      if (attachment) {
                        formData.append("attachment", attachment);
                      }

                      fetcher.submit(formData, {
                        method: "post",
                        encType: "multipart/form-data",
                      });
                          }
                          }
                        >
                          Create Order
                        </Button>

  <Button
    variant="primary"
    disabled={!payAmount || payAmount <= 0}
    onClick={() =>
    {
      const formData = new FormData();

      formData.append("intent", "submit_payment");
      formData.append("payAmount", payAmount);
      formData.append("poNumber", poNumber);
      formData.append("vendor", vendor);
      formData.append("readyDate", readyDate);
      formData.append("note", note);
      formData.append("items", JSON.stringify(items));

      if (attachment) {
        formData.append("attachment", attachment);
      }

      fetcher.submit(formData, {
        method: "post",
        encType: "multipart/form-data",
      });

    }
    }
  >
    Submit Payment
  </Button>
</InlineStack>
            </BlockStack>
                </Card>
                
              </Layout.Section>
            </Layout>
          </Layout.Section>

          {/* ================= FOOTER ================= */}
          <Layout.Section>

          </Layout.Section>

        </Layout>
      </Page>

      {showCreateModal && (
  <Modal
    open={showCreateModal}
    onClose={() => setShowCreateModal(false)}
    title="Create Product"
    primaryAction={{
      content: "Create Product",
      onAction: () => {
        const formData = new FormData();
        formData.append("intent", "create_product");
        formData.append("title", newProduct.title);
        formData.append("sku", newProduct.sku);
        formData.append("price", newProduct.price);
        formData.append("quantity", newProduct.quantity);

        fetcher.submit(formData, { method: "post" });
      },
    }}
  >
    <Modal.Section>
      <BlockStack gap="200">
        <TextField
          label="Title"
          value={newProduct.title}
          onChange={(v) => setNewProduct(p => ({ ...p, title: v }))}
        />
        <TextField
          label="SKU"
          value={newProduct.sku}
          onChange={(v) => setNewProduct(p => ({ ...p, sku: v }))}
        />
        <TextField
          label="Cost"
          type="number"
          value={newProduct.price}
          onChange={(v) => setNewProduct(p => ({ ...p, price: v }))}
        />
        <TextField
          label="Quantity"
          type="number"
          value={newProduct.quantity}
          onChange={(v) => setNewProduct(p => ({ ...p, quantity: v }))}
        />
      </BlockStack>
    </Modal.Section>
  </Modal>
)}


      {toast.show && (
       <Toast
  content={toast.message}
  error={toast.error}
  onDismiss={() =>
    setToast({ show: false, message: "", error: false })
  }
/>
      )}
    </Frame>
  );
}
