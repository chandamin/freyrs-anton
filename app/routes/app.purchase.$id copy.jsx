import {
  Page, Card, Layout, TextField, Button, InlineStack, BlockStack,
  DataTable, Text, Select, Toast, Frame, InlineGrid, Modal
} from "@shopify/polaris";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import { useEffect, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { PlusIcon } from '@shopify/polaris-icons';

export async function loader({ params, request }) {
  await authenticate.admin(request);

  const order = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: { items: true, payments: true },
  });

  if (!order) throw new Response("Not found", { status: 404 });

  // 🧮 Pure Code-Based Calculations (No DB fields needed)
  const totalQty = order.items.reduce((sum, i) => sum + i.quantity, 0);
  const receivedQty = order.items.reduce((sum, i) => sum + i.receivedQty, 0);
  const totalOnOrder = totalQty - receivedQty;
  const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
  
  // Balance = (Items Total + Shipping) - Payments
  const balance = (order.totalAmount + order.shipping) - totalPaid;

  return json({ order, totalQty, totalOnOrder, totalPaid, balance });
}

export async function action({ request, params }) {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const orderId = params.id;

  // Function to keep totalAmount & totalUnits in sync with DB schema
  const syncTotals = async () => {
    const items = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: orderId } });
    const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
    const totalAmount = items.reduce((s, i) => s + i.subtotal, 0);
    await prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { totalUnits, totalAmount }
    });
  };

  if (intent === "update_item") {
    const q = Number(formData.get("quantity"));
    const c = Number(formData.get("cost"));
    await prisma.purchaseOrderItem.update({
      where: { id: formData.get("itemId") },
      data: { quantity: q, cost: c, subtotal: q * c }
    });
    await syncTotals();
    return json({ success: true });
  }

  if (intent === "receive_qty") {
    await prisma.purchaseOrderItem.update({
      where: { id: formData.get("itemId") },
      data: { receivedQty: { increment: Number(formData.get("receiveQty")) } }
    });
    return json({ success: true });
  }

  if (intent === "submit_payment") {
    await prisma.payment.create({
      data: { purchaseOrderId: orderId, amount: Number(formData.get("amount")) }
    });
    return json({ success: true });
  }

  return json({ success: true });
}

export default function OrderDetails() {
  const { order, totalQty, totalOnOrder, totalPaid, balance } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [qtyMap, setQtyMap] = useState({});
  const [receiveMap, setReceiveMap] = useState({});

  useEffect(() => {
    const q = {};
    order.items.forEach(i => q[i.id] = i.quantity);
    setQtyMap(q);
  }, [order]);

  return (
    <Frame>
      <Page title={`Order ${order.poNumber}`} backAction={{ onAction: () => navigate(-1) }}>
        <Layout>
          {/* PRODUCT TABLE */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd">Items</Text>
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric", "text"]}
                  headings={["Product", "Qty", "Cost", "On Order", "Receive", "Action"]}
                  rows={order.items.map((i) => [
                    i.title,
                    <TextField labelHidden type="number" value={qtyMap[i.id]} onChange={(v) => setQtyMap({...qtyMap, [i.id]: v})} onBlur={() => {
                        const fd = new FormData(); fd.append("intent", "update_item"); fd.append("itemId", i.id); fd.append("quantity", qtyMap[i.id]); fd.append("cost", i.cost);
                        fetcher.submit(fd, { method: "post" });
                    }} autoComplete="off" />,
                    `$${i.cost}`,
                    i.quantity - i.receivedQty,
                    <TextField labelHidden placeholder="0" type="number" value={receiveMap[i.id] || ""} onChange={(v) => setReceiveMap({...receiveMap, [i.id]: v})} onBlur={() => {
                        if(!receiveMap[i.id]) return;
                        const fd = new FormData(); fd.append("intent", "receive_qty"); fd.append("itemId", i.id); fd.append("receiveQty", receiveMap[i.id]);
                        fetcher.submit(fd, { method: "post" });
                        setReceiveMap({...receiveMap, [i.id]: ""});
                    }} autoComplete="off" />,
                    <Button tone="critical" size="slim">Remove</Button>
                  ])}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* FINANCIAL SUMMARY */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd">Summary</Text>
                <InlineStack align="space-between"><Text>Items Total:</Text><Text>${order.totalAmount.toFixed(2)}</Text></InlineStack>
                <InlineStack align="space-between"><Text>Shipping:</Text><Text>${order.shipping.toFixed(2)}</Text></InlineStack>
                <hr style={{ border: "0.5px solid #eee" }} />
                <InlineStack align="space-between"><Text variant="headingSm">Grand Total:</Text><Text>${(order.totalAmount + order.shipping).toFixed(2)}</Text></InlineStack>
                <InlineStack align="space-between"><Text tone="success">Paid:</Text><Text>-${totalPaid.toFixed(2)}</Text></InlineStack>
                <InlineStack align="space-between">
                    <Text variant="headingMd">Balance Due:</Text>
                    <Text variant="headingMd" tone={balance > 0 ? "critical" : "success"}>${balance.toFixed(2)}</Text>
                </InlineStack>

                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="submit_payment" />
                    <BlockStack gap="200">
                        <TextField label="Add Payment" name="amount" type="number" prefix="$" autoComplete="off" />
                        <Button submit primary fill>Record Payment</Button>
                    </BlockStack>
                </fetcher.Form>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}