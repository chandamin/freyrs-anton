import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher, useSearchParams } from "@remix-run/react";
import prisma from "../db.server";
import {
  Page,
  Card,
  Button,
  Text,
  Select,
  InlineStack,
  Pagination,
  Badge,
  BlockStack,
  Box,
  Divider,
  ButtonGroup,
  IndexTable,
  InlineGrid,
} from "@shopify/polaris";
import { 
  ExportIcon, 
  PrintIcon, 
  DeleteIcon, 
  ViewIcon, 
  PlusIcon,
  CashDollarIcon,
  CartIcon,
  CalendarIcon
} from "@shopify/polaris-icons";

/* =========================
   LOADER: FETCH FROM DB
========================= */
export async function loader({ request }) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = 10;
  const skip = (page - 1) * pageSize;

  const totalCount = await prisma.purchaseOrder.count();
  
  const orders = await prisma.purchaseOrder.findMany({
    include: {
      items: true,
      payments: true,
    },
    orderBy: { createdAt: "desc" },
    skip,
    take: pageSize,
  });

  const rows = orders.map((o) => {
    const totalQty = o.totalQuantity || 0; 
    const receivedQty = o.items.reduce((s, i) => s + (i.receivedQty || 0), 0);
    const onOrder = totalQty - receivedQty;
    const paid = o.payments.reduce((s, p) => s + p.amount, 0);
    const balance = o.totalAmount + (o.shipping || 0) - paid;

    return {
      ...o,
      totalQty,
      onOrder,
      balance,
    };
  });

  return json({ 
    orders: rows,
    pagination: {
      currentPage: page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    }
  });
}

/* =========================
   UTILITIES: EXPORT
========================= */
function exportToCSV(orders) {
  const headers = ["#PO", "Order Date", "Vendor", "Total Qty", "On Order", "Ready Date", "Total", "Balance", "Status"];
  const csvRows = [
    headers.join(","),
    ...orders.map((o) => [
      o.poNumber,
      new Date(o.createdAt).toISOString().slice(0, 10),
      `"${o.vendor}"`,
      o.totalQty,
      o.onOrder,
      new Date(o.readyDate).toISOString().slice(0, 10),
      o.totalAmount.toFixed(2),
      o.balance.toFixed(2),
      o.status,
    ].join(","))
  ];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `PO_Export_${Date.now()}.csv`;
  link.click();
}

function exportToPDF(orders) {
  const printWindow = window.open("", "", "height=800,width=1000");
  printWindow.document.write(`
    <html>
      <head>
        <title>Purchase Orders Report</title>
        <style>
          body { font-family: sans-serif; margin: 30px; color: #333; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #dfe3e8; padding: 12px 8px; text-align: left; font-size: 12px; }
          th { background-color: #f4f6f8; font-weight: bold; text-transform: uppercase; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 10px; }
          .text-right { text-align: right; }
        </style>
      </head>
      <body>
        <div class="header">
            <h1>Purchase Orders Report</h1>
            <p>Generated on: ${new Date().toLocaleDateString()}</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>PO #</th><th>Date</th><th>Vendor</th><th>Qty</th><th>Total</th><th>Balance</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map(o => `
              <tr>
                <td><strong>${o.poNumber}</strong></td>
                <td>${new Date(o.createdAt).toLocaleDateString()}</td>
                <td>${o.vendor}</td>
                <td>${o.totalQty}</td>
                <td class="text-right">$${o.totalAmount.toFixed(2)}</td>
                <td class="text-right">$${o.balance.toFixed(2)}</td>
                <td>${o.status}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
}

/* =========================
   UI COMPONENT
========================= */
export default function PurchaseList() {
  const { orders, pagination } = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();

  const statusOptions = [
    { label: "Pending", value: "PENDING" },
    { label: "In Progress", value: "IN_PROGRESS" },
    { label: "Completed", value: "COMPLETED" },
  ];

  const handlePageChange = (newPage) => {
    setSearchParams({ page: newPage.toString() });
  };

  const { currentPage, totalPages, totalCount, pageSize } = pagination;
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalCount);

  const rowMarkup = orders.map((o, index) => (
    <IndexTable.Row id={o.id} key={o.id} position={index}>
      <IndexTable.Cell>
        <Button variant="plain" onClick={() => navigate(`/app/purchase/${o.id}`)}>
          <Text fontWeight="bold" tone="magic">{o.poNumber}</Text>
        </Button>
      </IndexTable.Cell>
      <IndexTable.Cell>{new Date(o.createdAt).toLocaleDateString()}</IndexTable.Cell>
      <IndexTable.Cell><Text fontWeight="medium">{o.vendor}</Text></IndexTable.Cell>
      <IndexTable.Cell>{o.totalQty}</IndexTable.Cell>
      <IndexTable.Cell>
        {o.onOrder > 0 ? <Badge tone="warning">{o.onOrder} Left</Badge> : <Badge tone="success">Filled</Badge>}
      </IndexTable.Cell>
      <IndexTable.Cell>{new Date(o.readyDate).toLocaleDateString()}</IndexTable.Cell>
      <IndexTable.Cell><Text fontWeight="bold">${o.totalAmount.toFixed(2)}</Text></IndexTable.Cell>
      <IndexTable.Cell>
        <Text tone={o.balance > 0 ? "critical" : "success"}>${o.balance.toFixed(2)}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <div onClick={(e) => e.stopPropagation()}>
          <Select
            label="Status" labelHidden
            options={statusOptions}
            value={o.status}
            onChange={(value) => fetcher.submit({ intent: "update_status", id: o.id, status: value }, { method: "post" })}
          />
        </div>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <ButtonGroup variant="segmented">
          <Button icon={ViewIcon} onClick={() => navigate(`/app/purchase/${o.id}`)} />
          <Button 
            icon={DeleteIcon} 
            tone="critical" 
            onClick={() => { if (confirm('Delete this PO?')) fetcher.submit({ intent: "delete_po", id: o.id }, { method: "post" }); }} 
          />
        </ButtonGroup>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      fullWidth
      title="Purchase Orders"
      primaryAction={{
        content: 'Create Order',
        icon: PlusIcon,
        onAction: () => navigate('/app/purchase-order'),
      }}
    >
      <BlockStack gap="500">
        
        {/* TOP STATS CARDS */}
        <InlineGrid columns={{xs: 1, md: 3}} gap="400">
          <Card padding="400">
            <InlineStack align="space-between">
                <BlockStack gap="100">
                    <Text variant="headingSm" tone="subdued">Active Orders</Text>
                    <Text variant="heading2xl">{totalCount}</Text>
                </BlockStack>
                <Box padding="200" background="bg-surface-secondary" borderRadius="200"><CartIcon width="32" /></Box>
            </InlineStack>
          </Card>
          <Card padding="400">
             <InlineStack align="space-between">
                <BlockStack gap="100">
                    <Text variant="headingSm" tone="subdued">Unpaid Balance</Text>
                    <Text variant="heading2xl" tone="critical">
                        ${orders.reduce((sum, o) => sum + (o.balance > 0 ? o.balance : 0), 0).toLocaleString()}
                    </Text>
                </BlockStack>
                <Box padding="200" background="bg-surface-secondary" borderRadius="200"><CashDollarIcon width="32" /></Box>
            </InlineStack>
          </Card>
          <Card padding="400">
            <InlineStack align="space-between">
                <BlockStack gap="100">
                    <Text variant="headingSm" tone="subdued">Total PO Value</Text>
                    <Text variant="heading2xl">
                        ${orders.reduce((sum, o) => sum + o.totalAmount, 0).toLocaleString()}
                    </Text>
                </BlockStack>
                <Box padding="200" background="bg-surface-secondary" borderRadius="200"><CalendarIcon width="32" /></Box>
            </InlineStack>
          </Card>
        </InlineGrid>

        {/* MAIN LIST CARD */}
        <Card padding="0">
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd">Purchase Log</Text>
              <ButtonGroup>
                <Button icon={ExportIcon} onClick={() => exportToCSV(orders)}>Export CSV</Button>
                <Button icon={PrintIcon} onClick={() => exportToPDF(orders)}>Print PDF</Button>
              </ButtonGroup>
            </InlineStack>
          </Box>
          <Divider />
          
          <IndexTable
            resourceName={{singular: 'order', plural: 'orders'}}
            itemCount={orders.length}
            selectable={false}
            headings={[
              {title: 'PO #'},
              {title: 'Date'},
              {title: 'Vendor'},
              {title: 'Qty'},
              {title: 'Pending'},
              {title: 'Ready'},
              {title: 'Total'},
              {title: 'Balance'},
              {title: 'Status'},
              {title: 'Actions'},
            ]}
          >
            {rowMarkup}
          </IndexTable>

          {orders.length === 0 && (
            <Box padding="1000" textAlign="center">
              <BlockStack gap="200">
                <Text tone="subdued">No purchase orders found.</Text>
                <Button onClick={() => navigate('/app/purchase-order')}>Create Your First Order</Button>
              </BlockStack>
            </Box>
          )}

          <Divider />
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="bodySm" tone="subdued">Showing {startItem}-{endItem} of {totalCount} orders</Text>
              <Pagination
                hasPrevious={currentPage > 1}
                onPrevious={() => handlePageChange(currentPage - 1)}
                hasNext={currentPage < totalPages}
                onNext={() => handlePageChange(currentPage + 1)}
                label={`Page ${currentPage} of ${totalPages}`}
              />
            </InlineStack>
          </Box>
        </Card>
      </BlockStack>
    </Page>
  );
}

/* =========================
   ACTION: UPDATE/DELETE
========================= */
export async function action({ request }) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = formData.get("id");

  if (intent === "update_status") {
    await prisma.purchaseOrder.update({ where: { id }, data: { status: formData.get("status") } });
    return json({ success: true });
  }

  if (intent === "delete_po") {
    await prisma.payment.deleteMany({ where: { purchaseOrderId: id } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
    await prisma.purchaseOrder.delete({ where: { id } });
    return json({ success: true });
  }

  return json({ error: "Invalid action" }, { status: 400 });
}