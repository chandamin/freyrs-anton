import {
  Page, Card, Layout, TextField, Button, InlineStack, BlockStack,
  DataTable, Text, Toast, Frame, Spinner, DropZone, Modal,
  InlineGrid, Box, Divider, Badge
} from "@shopify/polaris";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import fs from "fs";

/* =========================
   LOADER: SEARCH PRODUCTS
   ========================= */
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("query");

  if (!query || query.trim().length < 2) {
    return json({ variants: [], blocked: true });
  }

  const response = await admin.graphql(
    `query ($query: String!) {
      products(first: 20, query: $query) {
        edges {
          node {
            variants(first: 20) {
              edges {
                node {
                  id title sku price
                  product { title }
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { query } }
  );

  const data = await response.json();
  const variants = data?.data?.products?.edges?.flatMap((p) =>
    p.node.variants.edges.map((v) => v.node)
  ) || [];

  return json({ variants, blocked: false });
}

/* =========================
   ACTION: LOGIC HANDLER
   ========================= */
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // 1. QUICK CREATE PRODUCT LOGIC
  if (intent === "create_product") {
    const title = formData.get("title");
    const sku = formData.get("sku");
    const price = formData.get("price");
    const quantity = Number(formData.get("quantity") || 0);

    const locRes = await admin.graphql(`query { locations(first: 1) { nodes { id } } }`);
    const locData = await locRes.json();
    const locationId = locData?.data?.locations?.nodes?.[0]?.id;

    const response = await admin.graphql(
      `mutation CreateProduct($input: ProductSetInput!) {
        productSet(synchronous: true, input: $input) {
          product {
            id
            variants(first: 1) { nodes { id title sku price product { title } } }
          }
          userErrors { message }
        }
      }`,
      {
        variables: {
          input: {
            title,
            productOptions: [{ name: "Title", values: [{ name: "Default" }] }],
            variants: [{
              sku, price,
              optionValues: [{ optionName: "Title", name: "Default" }],
              inventoryQuantities: [{ locationId, name: "available", quantity }]
            }]
          }
        }
      }
    );

    const result = await response.json();
    if (result.data?.productSet?.userErrors?.length) {
      return json({ error: result.data.productSet.userErrors[0].message });
    }
    return json({ 
      success: true, 
      createdVariant: result.data.productSet.product.variants.nodes[0],
      message: "Product created and added to order!" 
    });
  }

  // 2. PURCHASE ORDER LOGIC
  const poNumber = formData.get("poNumber");
  const vendor = formData.get("vendor");
  const readyDate = formData.get("readyDate");
  const note = formData.get("note") || "";
  const items = JSON.parse(formData.get("items") || "[]");
  const payAmount = Number(formData.get("payAmount") || 0);
  const attachmentFile = formData.get("attachment");

  let attachmentPath = null;
  if (attachmentFile && typeof attachmentFile === "object" && attachmentFile.name) {
    const buffer = Buffer.from(await attachmentFile.arrayBuffer());
    const uploadDir = "public/uploads";
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filePath = `${uploadDir}/${Date.now()}-${attachmentFile.name}`;
    fs.writeFileSync(filePath, buffer);
    attachmentPath = filePath.replace("public", "");
  }

  const totalAmount = items.reduce((s, i) => s + (Number(i.quantity) * Number(i.cost)), 0);
  const totalQuantity = items.reduce((s, i) => s + Number(i.quantity), 0);

  let po = await prisma.purchaseOrder.findUnique({ where: { poNumber }, include: { payments: true } });

  if (intent === "create_order") {
    if (po) return json({ error: "PO Number already exists!" });
    
    po = await prisma.purchaseOrder.create({
      data: {
        poNumber, vendor, readyDate: new Date(readyDate), note, 
        attachment: attachmentPath, totalQuantity, totalAmount, 
        balance: totalAmount - payAmount, 
        status: payAmount >= totalAmount ? "COMPLETED" : "PENDING",
        items: { 
          create: items.map(i => ({ 
            variantId: i.id, title: i.title, sku: i.sku || "", 
            quantity: Number(i.quantity), cost: Number(i.cost), 
            subtotal: Number(i.quantity) * Number(i.cost) 
          })) 
        },
        payments: payAmount > 0 ? { create: { amount: payAmount } } : undefined
      }
    });
    return json({ success: true, message: "Order Created Successfully!", poId: po.id });
  }

  if (intent === "submit_payment" && po) {
    await prisma.payment.create({ data: { purchaseOrderId: po.id, amount: payAmount } });
    const allPayments = await prisma.payment.findMany({ where: { purchaseOrderId: po.id } });
    const totalPaid = allPayments.reduce((s, p) => s + p.amount, 0);
    const newBalance = po.totalAmount - totalPaid;
    const newStatus = totalPaid >= po.totalAmount ? "COMPLETED" : "IN_PROGRESS";
    
    await prisma.purchaseOrder.update({ 
        where: { id: po.id }, 
        data: { balance: newBalance, status: newStatus } 
    });
    return json({ success: true, message: "Payment recorded!" });
  }

  return json({ error: "Invalid Request" });
}

/* =========================
   COMPONENT: UI
   ========================= */
export default function CreatePurchaseOrder() {
  const fetcher = useFetcher();
  const [items, setItems] = useState([]);
  const [poNumber, setPoNumber] = useState("#PO-" + Math.floor(1000 + Math.random() * 9000));
  const [vendor, setVendor] = useState("");
  const [readyDate, setReadyDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState("");
  const [payAmount, setPayAmount] = useState("0");
  const [attachment, setAttachment] = useState(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  
  // MODAL STATES
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProd, setNewProd] = useState({ title: "", sku: "", price: "", quantity: "0" });
  const [toast, setToast] = useState({ show: false, message: "", error: false });

  // Handle Response Logic
  useEffect(() => {
    if (fetcher.data?.variants) setResults(fetcher.data.variants);
    
    if (fetcher.data?.createdVariant) {
      const v = fetcher.data.createdVariant;
      setItems(prev => [...prev, { 
        id: v.id, 
        title: `${v.product.title} — ${v.title}`, 
        sku: v.sku || "-", 
        quantity: 1, 
        cost: Number(v.price) 
      }]);
      setShowCreateModal(false);
      setNewProd({ title: "", sku: "", price: "", quantity: "0" });
    }

    if (fetcher.data?.success) {
      setToast({ show: true, message: fetcher.data.message, error: false });
      if(fetcher.data.poId) { 
        setItems([]); setVendor(""); setPayAmount("0"); setNote(""); setAttachment(null); 
      }
    }
    if (fetcher.data?.error) setToast({ show: true, message: fetcher.data.error, error: true });
  }, [fetcher.data]);

  // Real-time Search Effect
  useEffect(() => {
    if (search.length >= 2) {
      fetcher.load(`?query=${search}`);
    } else {
      setResults([]);
    }
  }, [search]);

  const totalAmount = items.reduce((s, i) => s + (i.quantity * i.cost), 0);
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const balance = totalAmount - Number(payAmount || 0);

  const handleOrderSubmit = (intent) => {
    if(!vendor || items.length === 0) {
        setToast({ show: true, message: "Please add Vendor and at least one item.", error: true });
        return;
    }
    const fd = new FormData();
    fd.append("intent", intent);
    fd.append("poNumber", poNumber);
    fd.append("vendor", vendor);
    fd.append("readyDate", readyDate);
    fd.append("note", note);
    fd.append("items", JSON.stringify(items));
    fd.append("payAmount", payAmount);
    if (attachment) fd.append("attachment", attachment);
    fetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  };

  return (
    <Frame>
      <Page title="Create Purchase Order" backAction={{content: 'Orders', url: '/app/purchase-list'}}>
        <Layout>
          
          {/* SECTION: BASIC INFO */}
          <Layout.Section>
            <Card>
              <InlineGrid columns={3} gap="400">
                <TextField label="PO Number" value={poNumber} onChange={setPoNumber} autoComplete="off" />
                <TextField label="Vendor Name" value={vendor} onChange={setVendor} placeholder="Search or Enter Vendor" />
                <TextField label="Expected Ready Date" type="date" value={readyDate} onChange={setReadyDate} />
              </InlineGrid>
            </Card>
          </Layout.Section>

          {/* SECTION: SEARCH & QUICK ADD */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="400" align="space-between">
                  <Box minWidth="300px" style={{ flex: 1 }}>
                    <TextField 
                      label="Search Products" 
                      placeholder="Search by SKU or Title..." 
                      value={search} 
                      onChange={setSearch} 
                      prefix={fetcher.state === "loading" && <Spinner size="small" />}
                      autoComplete="off"
                    />
                  </Box>
                  <Button variant="secondary" onClick={() => setShowCreateModal(true)}>+ Quick Create Product</Button>
                </InlineStack>
                
                {results.length > 0 && (
                  <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid #dfe3e8', borderRadius: '8px' }}>
                    <DataTable
                      columnContentTypes={["text","text","numeric","text"]}
                      headings={["Variant","SKU","Price",""]}
                      rows={results.map(v => [
                        `${v.product.title} — ${v.title}`, 
                        v.sku || "-", 
                        `$${v.price}`,
                        <Button size="slim" onClick={() => {
                            if(!items.find(i => i.id === v.id)) {
                              setItems([...items, { id: v.id, title: `${v.product.title} — ${v.title}`, sku: v.sku, quantity: 1, cost: Number(v.price) }]);
                            }
                            setSearch(""); setResults([]);
                        }}>Add</Button>
                      ])}
                    />
                  </div>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* SECTION: ITEMS TABLE */}
          <Layout.Section>
            <Card padding="0">
              <DataTable
                columnContentTypes={["text","numeric","numeric","numeric","text"]}
                headings={["Item Description","Qty","Cost","Subtotal",""]}
                rows={items.length === 0 ? [["No items added.", "", "", "", ""]] : items.map((item, i) => [
                  item.title,
                  <TextField type="number" value={String(item.quantity)} onChange={v => { const n = [...items]; n[i].quantity = Number(v); setItems(n); }} />,
                  <TextField type="number" prefix="$" value={String(item.cost)} onChange={v => { const n = [...items]; n[i].cost = Number(v); setItems(n); }} />,
                  <Text fontWeight="bold">{`$${(item.quantity * item.cost).toFixed(2)}`}</Text>,
                  <Button tone="critical" variant="tertiary" onClick={() => setItems(items.filter((_, idx) => idx !== i))}>Remove</Button>
                ])}
              />
            </Card>
          </Layout.Section>

          {/* SECTION: SUMMARY & PAYMENT */}
          <Layout.Section>
            <InlineGrid columns={["twoThirds","oneThird"]} gap="400">
              <Card>
                <BlockStack gap="400">
                  <TextField label="Additional Note" multiline={4} value={note} onChange={setNote} placeholder="Internal notes regarding this order..." />
                  <Divider />
                  <Text variant="headingSm">Attachment</Text>
                  <DropZone label="Invoice or Photo" onDrop={(_, files) => setAttachment(files[0])}>
                    {attachment ? (
                      <Box padding="200"><Badge tone="info">{attachment.name}</Badge></Box>
                    ) : <DropZone.FileUpload />}
                  </DropZone>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd">Summary</Text>
                  <InlineStack align="space-between"><Text tone="subdued">Total Qty</Text><Text>{totalQty}</Text></InlineStack>
                  <InlineStack align="space-between"><Text tone="subdued">Subtotal</Text><Text fontWeight="bold">${totalAmount.toFixed(2)}</Text></InlineStack>
                  <Divider />
                  <TextField label="Payment Amount" type="number" prefix="$" value={payAmount} onChange={setPayAmount} helpText="Amount paid to vendor today." />
                  <InlineStack align="space-between">
                    <Text variant="headingSm">Balance Due</Text>
                    <Text variant="headingSm" tone={balance > 0 ? "critical" : "success"}>${balance.toFixed(2)}</Text>
                  </InlineStack>
                  <Box paddingBlockStart="400">
                    <BlockStack gap="200">
                      <Button variant="primary" size="large" fullWidth loading={fetcher.state !== "idle"} onClick={() => handleOrderSubmit("create_order")}>Save & Create PO</Button>
                      <Button fullWidth onClick={() => handleOrderSubmit("submit_payment")}>Record Payment Only</Button>
                    </BlockStack>
                  </Box>
                </BlockStack>
              </Card>
            </InlineGrid>
          </Layout.Section>
        </Layout>
      </Page>

      {/* QUICK CREATE MODAL */}
      <Modal 
        open={showCreateModal} 
        onClose={() => setShowCreateModal(false)} 
        title="Quick Create Product"
        primaryAction={{ 
          content: "Save & Add to Order", 
          loading: fetcher.state !== "idle",
          onAction: () => {
            const fd = new FormData();
            fd.append("intent", "create_product");
            fd.append("title", newProd.title); 
            fd.append("sku", newProd.sku);
            fd.append("price", newProd.price); 
            fd.append("quantity", newProd.quantity);
            fetcher.submit(fd, { method: "post" });
          }
        }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField label="Product Title" value={newProd.title} onChange={v => setNewProd(p => ({...p, title: v}))} autoComplete="off" />
            <TextField label="SKU" value={newProd.sku} onChange={v => setNewProd(p => ({...p, sku: v}))} autoComplete="off" />
            <InlineGrid columns={2} gap="400">
              <TextField label="Cost Price" type="number" prefix="$" value={newProd.price} onChange={v => setNewProd(p => ({...p, price: v}))} />
              <TextField label="Initial Quantity" type="number" value={newProd.quantity} onChange={v => setNewProd(p => ({...p, quantity: v}))} />
            </InlineGrid>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {toast.show && <Toast content={toast.message} error={toast.error} onDismiss={() => setToast({show: false, message: "", error: false})} />}
    </Frame>
  );
}