import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher, useSearchParams } from "@remix-run/react";
import prisma from "../db.server";
import {
  Page,
  Card,
  DataTable,
  Button,
  Text,
  Select,
  InlineStack,
  Pagination,
} from "@shopify/polaris";

/* =========================
   LOADER
========================= */
export async function loader({ request }) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = 10; // Items per page
  
  const skip = (page - 1) * pageSize;

  // Get total count for pagination
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
    const totalQty = o.items.reduce((s, i) => s + i.quantity, 0);
    const receivedQty = o.items.reduce((s, i) => s + i.receivedQty, 0);
    const onOrder = totalQty - receivedQty;

    const paid = o.payments.reduce((s, p) => s + p.amount, 0);
    const balance = o.totalAmount + o.shipping - paid;

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
   EXPORT FUNCTIONS
========================= */
function exportToCSV(orders) {
  const headers = [
    "#PO",
    "Order Date",
    "Vendor",
    "Total Qty",
    "On Order",
    "Ready Date",
    "Total",
    "Balance",
    "Due Date",
    "Status",
  ];

  const csvRows = [
    headers.join(","),
    ...orders.map((o) =>
      [
        o.poNumber,
        new Date(o.createdAt).toISOString().slice(0, 10),
        `"${o.vendor}"`,
        o.totalQty,
        o.onOrder,
        new Date(o.readyDate).toISOString().slice(0, 10),
        o.totalAmount.toFixed(2),
        o.balance.toFixed(2),
        o.dueDate ? new Date(o.dueDate).toISOString().slice(0, 10) : "-",
        o.status,
      ].join(",")
    ),
  ];

  const csvContent = csvRows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `purchase_orders_${Date.now()}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportToExcel(orders) {
  const headers = [
    "#PO",
    "Order Date",
    "Vendor",
    "Total Qty",
    "On Order",
    "Ready Date",
    "Total",
    "Balance",
    "Due Date",
    "Status",
  ];

  let tableHTML = '<table border="1"><thead><tr>';
  headers.forEach((h) => {
    tableHTML += `<th>${h}</th>`;
  });
  tableHTML += "</tr></thead><tbody>";

  orders.forEach((o) => {
    tableHTML += "<tr>";
    tableHTML += `<td>${o.poNumber}</td>`;
    tableHTML += `<td>${new Date(o.createdAt).toISOString().slice(0, 10)}</td>`;
    tableHTML += `<td>${o.vendor}</td>`;
    tableHTML += `<td>${o.totalQty}</td>`;
    tableHTML += `<td>${o.onOrder}</td>`;
    tableHTML += `<td>${new Date(o.readyDate).toISOString().slice(0, 10)}</td>`;
    tableHTML += `<td>${o.totalAmount.toFixed(2)}</td>`;
    tableHTML += `<td>${o.balance.toFixed(2)}</td>`;
    tableHTML += `<td>${
      o.dueDate ? new Date(o.dueDate).toISOString().slice(0, 10) : "-"
    }</td>`;
    tableHTML += `<td>${o.status}</td>`;
    tableHTML += "</tr>";
  });

  tableHTML += "</tbody></table>";

  const blob = new Blob([tableHTML], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `purchase_orders_${Date.now()}.xls`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportToPDF(orders) {
  const printWindow = window.open("", "", "height=800,width=1000");
  
  printWindow.document.write(`
    <html>
      <head>
        <title>Purchase Orders</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { text-align: center; color: #333; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
          th { background-color: #f2f2f2; font-weight: bold; }
          tr:nth-child(even) { background-color: #f9f9f9; }
          .text-right { text-align: right; }
          @media print {
            body { margin: 0; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <h1>Purchase Orders Report</h1>
        <p>Generated on: ${new Date().toLocaleString()}</p>
        <table>
          <thead>
            <tr>
              <th>#PO</th>
              <th>Order Date</th>
              <th>Vendor</th>
              <th>Total Qty</th>
              <th>On Order</th>
              <th>Ready Date</th>
              <th class="text-right">Total</th>
              <th class="text-right">Balance</th>
              <th>Due Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${orders
              .map(
                (o) => `
              <tr>
                <td>${o.poNumber}</td>
                <td>${new Date(o.createdAt).toISOString().slice(0, 10)}</td>
                <td>${o.vendor}</td>
                <td>${o.totalQty}</td>
                <td>${o.onOrder}</td>
                <td>${new Date(o.readyDate).toISOString().slice(0, 10)}</td>
                <td class="text-right">$${o.totalAmount.toFixed(2)}</td>
                <td class="text-right">$${o.balance.toFixed(2)}</td>
                <td>${
                  o.dueDate
                    ? new Date(o.dueDate).toISOString().slice(0, 10)
                    : "-"
                }</td>
                <td>${o.status}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 250);
}

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

  return (
    <Page title="Purchase Order">
      <Card>
        {/* EXPORT BUTTONS */}
        <InlineStack gap="200" align="start">
          <Button onClick={() => exportToCSV(orders)}>CSV</Button>
          <Button onClick={() => exportToExcel(orders)}>Excel</Button>
          <Button onClick={() => exportToPDF(orders)}>PDF</Button>
        </InlineStack>

        <DataTable
          columnContentTypes={[
            "text",
            "text",
            "text",
            "numeric",
            "numeric",
            "text",
            "numeric",
            "numeric",
            "text",
            "text",
            "text",
          ]}
          headings={[
            "#PO",
            "Order Date",
            "Vendor",
            "Total Qty",
            "On Order",
            "Ready Date",
            "Total",
            "Balance",
            "Due Date",
            "Status",
            "Action",
          ]}
          rows={orders.map((o) => [
            <Button
              plain
              onClick={() => navigate(`/app/purchase/${o.id}`)}
            >
              {o.poNumber}
            </Button>,
            new Date(o.createdAt).toISOString().slice(0, 10),
            o.vendor,
            o.totalQty,
            o.onOrder,
            new Date(o.readyDate).toISOString().slice(0, 10),
            `$${o.totalAmount.toFixed(2)}`,
            `$${o.balance.toFixed(2)}`,
            o.dueDate
              ? new Date(o.dueDate).toISOString().slice(0, 10)
              : "-",
            <Select
              options={statusOptions}
              value={o.status}
              onChange={(value) => {
                fetcher.submit(
                  {
                    intent: "update_status",
                    id: o.id,
                    status: value,
                  },
                  { method: "post" }
                );
              }}
            />,
            <Button
              tone="critical"
              onClick={() => {
                fetcher.submit(
                  { intent: "delete_po", id: o.id },
                  { method: "post" }
                );
              }}
            >
              Delete
            </Button>,
          ])}
        />

        {/* PAGINATION */}
        <div style={{ marginTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Text variant="bodySm" as="p" tone="subdued">
            Showing {startItem}-{endItem} of {totalCount} orders
          </Text>
          <Pagination
            hasPrevious={currentPage > 1}
            onPrevious={() => handlePageChange(currentPage - 1)}
            hasNext={currentPage < totalPages}
            onNext={() => handlePageChange(currentPage + 1)}
          />
        </div>
      </Card>
    </Page>
  );
}

export async function action({ request }) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update_status") {
    await prisma.purchaseOrder.update({
      where: { id: formData.get("id") },
      data: { status: formData.get("status") },
    });
    return json({ success: true });
  }

  if (intent === "delete_po") {
    const id = formData.get("id");

    await prisma.payment.deleteMany({
      where: { purchaseOrderId: id },
    });

    await prisma.purchaseOrderItem.deleteMany({
      where: { purchaseOrderId: id },
    });

    await prisma.purchaseOrder.delete({
      where: { id },
    });

    return json({ success: true });
  }

  return json({ error: "Invalid action" }, { status: 400 });
}