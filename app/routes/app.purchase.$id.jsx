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
  Select,
  Toast,
  Frame,
  DropZone,
  InlineGrid,
  Modal
} from "@shopify/polaris";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
} from "@remix-run/react";
import { useEffect, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import fs from "fs";
import {PlusIcon} from '@shopify/polaris-icons';

/* =========================
   LOADER
========================= */
export async function loader({ params, request }) {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("search");

  /* =========================
     🔍 SHOPIFY PRODUCT SEARCH
     ========================= */
  if (search && search.trim().length >= 2) {
    const response = await admin.graphql(
      `
      query ($query: String!) {
        products(first: 10, query: $query) {
          edges {
            node {
              title
              variants(first: 10) {
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
      { variables: { query: search } }
    );

    const data = await response.json();

    const variants =
      data?.data?.products?.edges.flatMap((p) =>
        p.node.variants.edges.map((v) => v.node)
      ) || [];

    return json({ variants });
  }

  /* =========================
     📦 EXISTING ORDER LOGIC (UNCHANGED)
     ========================= */
  const order = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: {
      items: true,
      payments: true,
    },
  });

  if (!order) throw new Response("Not found", { status: 404 });

  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const receivedQty = order.items.reduce((s, i) => s + i.receivedQty, 0);
  const totalOnOrder = totalQty - receivedQty;

  const computedTotal = order.items.reduce(
    (sum, i) => sum + i.quantity * i.cost,
    0
  );

  const paidAmount = order.payments.reduce(
    (s, p) => s + p.amount,
    0
  );

  const balance = computedTotal + order.shipping - paidAmount;


  return json({
    order,
    totalQty,
    totalOnOrder,
    paidAmount,
    balance,
    computedTotal,
  });

}


/* =========================
   ACTION
========================= */
export async function action({ request, params }) {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "add_manual_item") {
  await prisma.purchaseOrderItem.create({
    data: {
      purchaseOrderId: params.id,
      variantId: "manual",
      title: formData.get("title"),
      sku: formData.get("sku"),
      quantity: Number(formData.get("quantity")),
      receivedQty: 0,
      cost: Number(formData.get("cost")),
      subtotal:
        Number(formData.get("quantity")) *
        Number(formData.get("cost")),
    },
  });

  return json({
    success: true,
    message: "Product added to order",
  });
}


  /* ---------- UPDATE PRODUCT (QTY / COST) ---------- */
if (intent === "update_item") {
  const itemId = formData.get("itemId");
  const quantity = Number(formData.get("quantity"));
  const cost = Number(formData.get("cost"));

  // 1️⃣ Update item
  const item = await prisma.purchaseOrderItem.update({
    where: { id: itemId },
    data: {
      quantity,
      cost,
      subtotal: quantity * cost,
    },
  });

  // 2️⃣ Recalculate order total
  const items = await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrderId: item.purchaseOrderId },
  });

  const totalAmount = items.reduce(
    (sum, i) => sum + i.quantity * i.cost,
    0
  );

  // 3️⃣ Update order total
  await prisma.purchaseOrder.update({
    where: { id: item.purchaseOrderId },
    data: { totalAmount },
  });

  return json({
    success: true,
    message: "Item updated",
  });
}


  /* ---------- RECEIVE QTY ---------- */
if (intent === "receive_qty") {
  const itemId = formData.get("itemId");
  const receiveQty = Number(formData.get("receiveQty"));

  const item = await prisma.purchaseOrderItem.findUnique({
    where: { id: itemId },
  });

  if (!item) {
    return json({ error: "Item not found" }, { status: 404 });
  }

  const remaining = item.quantity - item.receivedQty;

  if (receiveQty <= 0) {
    return json({ error: "Invalid receive quantity" }, { status: 400 });
  }

  if (receiveQty > remaining) {
    return json(
      { error: `You can receive only ${remaining}` },
      { status: 400 }
    );
  }

  await prisma.purchaseOrderItem.update({
    where: { id: itemId },
    data: {
      receivedQty: {
        increment: receiveQty,
      },
    },
  });

  return json({
    success: true,
    message: `Received ${receiveQty}`,
  });
}

  /* ---------- REMOVE PRODUCT ---------- */
  if (intent === "remove_item") {
    await prisma.purchaseOrderItem.delete({
      where: { id: formData.get("itemId") },
    });
    
    return json({ success: true, message: "Product removed" });
  }

  /* ---------- UPDATE ORDER DETAILS ---------- */
if (intent === "update_order_details") {
  const poNumber = formData.get("poNumber");
  const status = formData.get("status");

  const orderDateRaw = formData.get("orderDate");
  const readyDateRaw = formData.get("readyDate");

  const data = {
    poNumber,
    status,
  };

  // ✅ only add if present
  if (orderDateRaw) {
    data.orderDate = new Date(orderDateRaw);
  }

  if (readyDateRaw) {
    data.readyDate = new Date(readyDateRaw);
  }

  await prisma.purchaseOrder.update({
    where: { id: params.id },
    data,
  });

  return json({
    success: true,
    message: "Order details updated",
  });
}


  /* ---------- UPDATE SHIPPING ---------- */
  if (intent === "update_shipping") {
    await prisma.purchaseOrder.update({
      where: { id: params.id },
      data: { shipping: Number(formData.get("shipping")) },
    });
    return json({ success: true, message: "Shipping updated" });
  }

  /* ---------- UPDATE DUE DATE ---------- */
  if (intent === "update_due_date") {
    await prisma.purchaseOrder.update({
      where: { id: params.id },
      data: { dueDate: new Date(formData.get("dueDate")) },
    });
    return json({ success: true, message: "Due date updated" });
  }

  /* ---------- ADD PAYMENT ---------- */
  if (intent === "submit_payment") {
    const amount = Number(formData.get("amount"));
    if (!amount || amount <= 0)
      return json({ error: "Enter valid amount" });

    await prisma.payment.create({
      data: {
        purchaseOrderId: params.id,
        amount,
      },
    });
    return json({ success: true, message: "Payment added" });
  }

  /* ---------- UPDATE NOTE ---------- */
  if (intent === "update_note") {
    let attachmentPath = null;
    const file = formData.get("attachment");

    if (file && typeof file === "object") {
      const buffer = Buffer.from(await file.arrayBuffer());
      const uploadDir = "public/uploads";
      if (!fs.existsSync(uploadDir))
        fs.mkdirSync(uploadDir, { recursive: true });
      const filePath = `${uploadDir}/${Date.now()}-${file.name}`;
      fs.writeFileSync(filePath, buffer);
      attachmentPath = filePath.replace("public", "");
    }

    await prisma.purchaseOrder.update({
      where: { id: params.id },
      data: {
        note: formData.get("note"),
        ...(attachmentPath && { attachment: attachmentPath }),
      },
    });

    return json({ success: true, message: "Note updated" });
  }

  /* ---------- UPDATE PAYMENT DATE ---------- */
if (intent === "update_payment_date") {
  await prisma.payment.update({
    where: { id: formData.get("paymentId") },
    data: {
      paidAt: new Date(formData.get("paidAt")),
    },
  });

  return json({
    success: true,
    message: "Payment date updated",
  });
}

if (intent === "add_shopify_item") {
  await prisma.purchaseOrderItem.create({
    data: {
      purchaseOrderId: params.id,
      variantId: formData.get("variantId"),
      title: formData.get("title"),
      sku: formData.get("sku"),
      quantity: Number(formData.get("quantity")),
      receivedQty: 0,
      cost: Number(formData.get("cost")),
      subtotal:
        Number(formData.get("quantity")) *
        Number(formData.get("cost")),
    },
  });

  return json({ success: true });
}


  return json({ error: "Invalid action" }, { status: 400 });
}

/* =========================
   COMPONENT
========================= */
export default function PurchaseOrderDetails() {
  const {
    order,
    totalQty,
    totalOnOrder,
    paidAmount,
    balance,
    computedTotal
  } = useLoaderData();

  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [qtyMap, setQtyMap] = useState({});
const [costMap, setCostMap] = useState({});
const [receiveMap, setReceiveMap] = useState({});
const [poNumber, setPoNumber] = useState(order.poNumber);
const [status, setStatus] = useState(order.status);
const [readyDate, setReadyDate] = useState(
  order.readyDate?.slice(0, 10)
);
const [orderDate, setOrderDate] = useState(
  order.createdAt?.slice(0, 10)
);
const [shipping, setShipping] = useState(order.shipping ?? 0);
const [dueDate, setDueDate] = useState(
  order.dueDate ? order.dueDate.slice(0, 10) : ""
);
const [payAmount, setPayAmount] = useState("");
const [note, setNote] = useState(order.note || "");
const [attachment, setAttachment] = useState(null);
const [paymentDates, setPaymentDates] = useState({});

const [showAddProductModal, setShowAddProductModal] = useState(false);

const [newItem, setNewItem] = useState({
  title: "",
  sku: "",
  quantity: "",
  cost: "",
});

const searchFetcher = useFetcher();
const [search, setSearch] = useState("");
const [selectedVariant, setSelectedVariant] = useState(null);





useEffect(() => {
  const q = {}, c = {}, r = {};
  order.items.forEach((i) => {
    console.log(i);
    q[i.id] = i.quantity;
    c[i.id] = i.cost;
    r[i.id] = i.receivedQty;
  });
  setQtyMap(q);
  setCostMap(c);
  setReceiveMap(r);
}, [order]);


  useEffect(() => {
    if (fetcher.data?.success)
      setToast({ message: fetcher.data.message });
    if (fetcher.data?.error)
      setToast({ message: fetcher.data.error, error: true });
  }, [fetcher.data]);

  return (
    <Frame>
      <Page
        title="Purchase Order Details"
        backAction={{ content: "Back", onAction: () => navigate(-1) }}
      >
        <Layout>

          {/* ================= PRODUCTS ================= */}
          <Layout.Section>
            <Card title="Products">
              <InlineGrid columns="1fr auto">
                <Text as="h2" variant="headingSm">
                  Products
                </Text>
                <Button
                  onClick={() => setShowAddProductModal(true)}
                  accessibilityLabel="Add variant"
                  icon={PlusIcon}
                >
                  Add variant
                </Button>
              </InlineGrid>
             <DataTable
                headings={[
                  "Title",
                  "SKU",
                  "Qty",
                  "Cost",
                  "On Order",
                  "Receive",
                  "Actions",
                ]}
                columnContentTypes={[
                  "text",
                  "text",
                  "numeric",
                  "numeric",
                  "numeric",
                  "numeric",
                  "text",
                ]}
                rows={order.items.map((i) => {
                const currentQty = qtyMap[i.id] ?? i.quantity;
                const received = i.receivedQty;
                const onOrder = currentQty - received;

                return [
                  /* ===== Title ===== */
                  i.title,

                  /* ===== SKU ===== */
                  <Text tone="subdued">{i.sku || "-"}</Text>,

                  /* ===== Quantity ===== */
                  <TextField
                    type="number"
                    value={currentQty}
                    labelHidden
                    autoComplete="off"
                    onChange={(val) =>
                      setQtyMap((m) => ({ ...m, [i.id]: Number(val) }))
                    }
                    onBlur={() => {
                      const formData = new FormData();
                      formData.append("intent", "update_item");
                      formData.append("itemId", i.id);
                      formData.append("quantity", currentQty);
                      formData.append("cost", costMap[i.id] ?? i.cost);
                      fetcher.submit(formData, { method: "post" });
                    }}
                  />,

                  /* ===== Cost ===== */
                  <TextField
                    type="number"
                    value={costMap[i.id] ?? i.cost}
                    labelHidden
                    autoComplete="off"
                    onChange={(val) =>
                      setCostMap((m) => ({ ...m, [i.id]: Number(val) }))
                    }
                    onBlur={() => {
                      const formData = new FormData();
                      formData.append("intent", "update_item");
                      formData.append("itemId", i.id);
                      formData.append("quantity", currentQty);
                      formData.append("cost", costMap[i.id] ?? i.cost);
                      fetcher.submit(formData, { method: "post" });
                    }}
                  />,

                  /* ===== On Order ===== */
                  <Text tone="subdued">{onOrder}</Text>,

                  /* ===== Receive ===== */
                  <TextField
                    type="number"
                    value={receiveMap[i.id] ?? ""}
                    labelHidden
                    autoComplete="off"
                    min={1}
                    max={onOrder}
                    disabled={onOrder <= 0}
                    onChange={(val) =>
                      setReceiveMap((m) => ({
                        ...m,
                        [i.id]: Math.min(Number(val), onOrder),
                      }))
                    }
                    onBlur={() => {
                      if (!receiveMap[i.id]) return;

                      const formData = new FormData();
                      formData.append("intent", "receive_qty");
                      formData.append("itemId", i.id);
                      formData.append("receiveQty", receiveMap[i.id]);

                      fetcher.submit(formData, { method: "post" });

                      setReceiveMap((m) => ({ ...m, [i.id]: "" }));
                    }}
                  />,

                  /* ===== Actions ===== */
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="remove_item" />
                    <input type="hidden" name="itemId" value={i.id} />
                    <Button tone="critical" size="slim" submit>
                      Remove
                    </Button>
                  </fetcher.Form>,
                ];
              })}

              />
            </Card>
          </Layout.Section>

          {/* ================= ORDER DETAILS + PAYMENT DETAILS ================= */}
          <Layout.Section>
          <Layout>

          {/* ================= ORDER DETAILS ================= */}
          <Layout.Section variant="oneHalf">
            <Card title="Order Details">
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="update_order_details" />

                <BlockStack gap="400">
                  {/* ===== PO NO + STATUS ===== */}
                  <InlineGrid gap="400" columns={2}>
                    <TextField
                      label="PO No"
                      name="poNumber"
                      value={poNumber}
                      onChange={setPoNumber}
                    />


                    <Select
                      label="Status"
                      name="status"
                      options={[
                        { label: "Pending", value: "PENDING" },
                        { label: "In Progress", value: "IN_PROGRESS" },
                        { label: "Completed", value: "COMPLETED" },
                      ]}
                      value={status}
                      onChange={setStatus}
                    />

                  </InlineGrid>

                  {/* ===== DATES ===== */}
                  <InlineGrid gap="400" columns={2}>
                    <TextField
                      label="Ready Date"
                      type="date"
                      name="readyDate"
                      value={readyDate}
                      onChange={setReadyDate}
                    />


                    <TextField
                      label="Order Date"
                      type="date"
                      name="orderDate"
                      value={orderDate}
                      onChange={setOrderDate}
                      disabled
                    />

                  </InlineGrid>

                  {/* ===== TOTALS ===== */}
                  <InlineGrid gap="400" columns={4}>
                    <Text tone="subdued">Total Quantity</Text>
                    <Text>{totalQty}</Text>

                    <Text tone="subdued">Total On Order</Text>
                    <Text>{totalOnOrder}</Text>
                  </InlineGrid>

                  {/* ===== VENDOR ===== */}
                  <InlineGrid gap="400" columns={2}>
                    <Text tone="subdued">Vendor</Text>
                    <Text>{order.vendor || "-"}</Text>
                  </InlineGrid>

                  {/* ===== ACTION ===== */}
                  <InlineStack>
                    <Button primary submit>
                      Update Order Details
                    </Button>
                  </InlineStack>

                </BlockStack>
              </fetcher.Form>
            </Card>
          </Layout.Section>


           {/* ================= PAYMENT DETAILS ================= */}
          <Layout.Section variant="oneHalf">
          <Card title="Payment Details">
            <BlockStack gap="400">

              {/* ===== Shipping ===== */}
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="update_shipping" />
                <InlineGrid gap="400" columns={2}>
                  <TextField
                    label="Shipping Amount"
                    name="shipping"
                    type="number"
                    value={shipping}
                    onChange={setShipping}
                  />
                  <Button submit>Update</Button>
                </InlineGrid>
              </fetcher.Form>

              {/* ===== Amount Summary (READ ONLY) ===== */}
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Amount Summary
                </Text>

                <InlineStack align="space-between">
                  <Text tone="subdued">Total</Text>
                  <Text>${computedTotal.toFixed(2)}</Text>
                </InlineStack>

                <InlineStack align="space-between">
                  <Text tone="subdued">Paid</Text>
                  <Text>${paidAmount.toFixed(2)}</Text>
                </InlineStack>

                <InlineStack align="space-between">
                  <Text tone="subdued">Balance</Text>
                  <Text tone={balance > 0 ? "critical" : "success"}>
                    ${balance.toFixed(2)}
                  </Text>
                </InlineStack>
              </BlockStack>

              {/* ===== Due Date ===== */}
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="update_due_date" />
                <InlineGrid gap="400" columns={2}>
                  <TextField
                    label="Due Date"
                    type="date"
                    name="dueDate"
                    value={dueDate}
                    onChange={setDueDate}
                  />
                  <Button submit>Update</Button>
                </InlineGrid>
              </fetcher.Form>

              {/* ===== Pay Balance ===== */}
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="submit_payment" />
                <InlineGrid gap="400" columns={2}>
                  <TextField
                    label="Pay Balance"
                    name="amount"
                    type="number"
                    value={payAmount}
                    onChange={setPayAmount}
                  />
                  <Button primary submit>Submit</Button>
                </InlineGrid>
              </fetcher.Form>

              {/* ===== Payment History ===== */}
              <InlineStack>
                <Button plain size="slim" onClick={() => setShowPaymentModal(true)}>
                  View payment history
                </Button>
              </InlineStack>

            </BlockStack>
          </Card>
          </Layout.Section>


          </Layout>
        </Layout.Section>


          {/* ================= NOTE ================= */}
         <Layout.Section>
  <Card title="Note">
    <fetcher.Form method="post" encType="multipart/form-data">
      <input type="hidden" name="intent" value="update_note" />

      <BlockStack gap="400">

        {/* ===== Note Text ===== */}
        <TextField
          label="Internal Note"
          multiline={4}
          value={note}
          onChange={setNote}
          name="note"
          placeholder="Add internal notes..."
        />

        {/* ===== Existing Attachment ===== */}
        {order.attachment && (
          <Text tone="subdued">
            Current attachment:{" "}
            <a
              href={order.attachment}
              target="_blank"
              rel="noopener noreferrer"
            >
              View file
            </a>
          </Text>
        )}

        {/* ===== Upload ===== */}
        <DropZone
  outline
  allowMultiple={false}
  onDrop={(_, acceptedFiles) =>
    setAttachment(acceptedFiles[0])
  }
>
  <DropZone.FileUpload />
</DropZone>


        {attachment && (
          <Text tone="subdued">
            Selected file: {attachment.name}
          </Text>
        )}

        {/* ===== Submit ===== */}
       <Button
  onClick={() => {
    const formData = new FormData();
    formData.append("intent", "update_note");
    formData.append("note", note);

    if (attachment) {
      formData.append("attachment", attachment);
    }

    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  }}
>
  Update Note
</Button>

      </BlockStack>
    </fetcher.Form>
  </Card>
</Layout.Section>


        </Layout>
      </Page>

      {showPaymentModal && (
  <Modal
    open
    onClose={() => setShowPaymentModal(false)}
    title="Payment Details"
    primaryAction={{
      content: "Close",
      onAction: () => setShowPaymentModal(false),
    }}
  >
    <Modal.Section>

      <BlockStack gap="400">

        {/* Header */}
        <InlineStack align="space-between">
          <Text as="h3" variant="headingSm">
            Payment Date
          </Text>
          <Text as="h3" variant="headingSm">
            Amount
          </Text>
        </InlineStack>

        {order.payments.length === 0 && (
          <Text tone="subdued">No payments found</Text>
        )}

{order.payments.map((p) => (
  <fetcher.Form method="post" key={p.id}>
    <input type="hidden" name="intent" value="update_payment_date" />
    <input type="hidden" name="paymentId" value={p.id} />

    <BlockStack gap="200">
      <InlineStack align="space-between" gap="400">
        <TextField
          type="date"
          name="paidAt"
          labelHidden
          value={
            paymentDates[p.id] ??
            p.paidAt.slice(0, 10)
          }
          onChange={(val) =>
            setPaymentDates((m) => ({
              ...m,
              [p.id]: val,
            }))
          }
        />

        <Text>${p.amount.toFixed(2)}</Text>
      </InlineStack>

      <InlineStack>
        <Button submit>
          Update Payment Date
        </Button>
      </InlineStack>
    </BlockStack>
  </fetcher.Form>
))}

      </BlockStack>

    </Modal.Section>
  </Modal>
)}


{showAddProductModal && (
  <Modal
    open
    title="Add more product"
    onClose={() => setShowAddProductModal(false)}
    primaryAction={{
      content: "Add Product",
      onAction: () => {
        if (!newItem.title || !newItem.quantity || !newItem.cost) return;

        const formData = new FormData();
        formData.append(
  "intent",
  selectedVariant ? "add_shopify_item" : "add_manual_item"
);

if (selectedVariant) {
  formData.append("variantId", selectedVariant.id);
}
        formData.append("title", newItem.title);
        formData.append("sku", newItem.sku || "-");
        formData.append("quantity", newItem.quantity);
        formData.append("cost", newItem.cost);

        fetcher.submit(formData, { method: "post" });

        setShowAddProductModal(false);
        setNewItem({ title: "", sku: "", quantity: "", cost: "" });
      },
    }}
    secondaryActions={[
      {
        content: "Cancel",
        onAction: () => setShowAddProductModal(false),
      },
    ]}
  >
    <Modal.Section>
      <BlockStack gap="300">

        <TextField
            placeholder="Search by title, SKU or barcode"
            value={search}
            onChange={(val) => {
              setSearch(val);

              if (val.length >= 2) {
                searchFetcher.submit(
                  { search: val },
                  { method: "get", action: "." }
                );
              }
            }}
            autoComplete="off"
          />
{searchFetcher.data?.variants?.length > 0 && (
  <Card>
    <BlockStack gap="200">
      {searchFetcher.data.variants.map((v) => (
        <InlineStack
          key={v.id}
          align="space-between"
        >
          <BlockStack>
            <Text>
              {v.product.title} — {v.title}
            </Text>
            <Text tone="subdued">
              SKU: {v.sku || "-"}
            </Text>
          </BlockStack>

          <Button
  size="slim"
  onClick={() => {
    const formData = new FormData();

    formData.append("intent", "add_shopify_item");
    formData.append("variantId", v.id);
    formData.append(
      "title",
      `${v.product.title} — ${v.title}`
    );
    formData.append("sku", v.sku || "-");
    formData.append("quantity", 1); // default qty
    formData.append("cost", v.price || 0);

    fetcher.submit(formData, { method: "post" });

    setShowAddProductModal(false);
    setSearch("");
  }}
>
  Add
</Button>

        </InlineStack>
      ))}
    </BlockStack>
  </Card>
)}


        <TextField
          label="Product Title"
          value={newItem.title}
          onChange={(v) =>
            setNewItem((p) => ({ ...p, title: v }))
          }
        />

        <TextField
          label="Product SKU"
          value={newItem.sku}
          onChange={(v) =>
            setNewItem((p) => ({ ...p, sku: v }))
          }
        />

        <TextField
          label="Quantity"
          type="number"
          value={newItem.quantity}
          onChange={(v) =>
            setNewItem((p) => ({ ...p, quantity: v }))
          }
        />

        <TextField
          label="Cost"
          type="number"
          value={newItem.cost}
          onChange={(v) =>
            setNewItem((p) => ({ ...p, cost: v }))
          }
        />

      </BlockStack>
    </Modal.Section>
  </Modal>
)}



      {toast && (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={() => setToast(null)}
        />
      )}
    </Frame>
  );
}
