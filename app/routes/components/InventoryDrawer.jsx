import {
  Card,
  Text,
  Button,
  ButtonGroup,
  BlockStack,
  InlineStack,
  Divider,
  Box,
  DataTable,
  Badge,
  Icon,
} from "@shopify/polaris";
import { XIcon, PackageIcon } from "@shopify/polaris-icons";

export default function InventoryDrawer({
  open,
  item,
  activeTab,
  setActiveTab,
  onClose,
}) {
  if (!open || !item) return null;

  // Determine stock status
  const stockStatus = item.onHand > 0 ? "success" : item.incoming > 0 ? "attention" : "critical";
  const stockLabel = item.onHand > 0 ? "In Stock" : item.incoming > 0 ? "Low Stock" : "Out of Stock";

  return (
    <>
      {/* Overlay with smooth transition */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 499,
          animation: "fadeIn 0.2s ease-out",
        }}
      />

      {/* Drawer with slide animation */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: "min(500px, 100vw)",
          background: "#fff",
          zIndex: 500,
          boxShadow: "-4px 0 20px rgba(0,0,0,0.15)",
          overflowY: "auto",
          animation: "slideIn 0.3s ease-out",
        }}
      >
        {/* Sticky Header */}
        <div
          style={{
            position: "sticky",
            top: 0,
            background: "#fff",
            zIndex: 10,
            borderBottom: "1px solid #e1e3e5",
            padding: "16px 20px",
          }}
        >
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="headingLg" as="h2">
              View Stock
            </Text>
            <Button
              onClick={onClose}
              icon={XIcon}
              variant="tertiary"
              accessibilityLabel="Close drawer"
            />
          </InlineStack>
        </div>

        <Box padding="400">
          <BlockStack gap="500">
            {/* Product Card with enhanced styling */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="center" blockAlign="start" gap="400">
                  {/* Product Image */}
                  <Box
                    minWidth="120px"
                    minHeight="120px"
                    maxWidth="120px"
                    maxHeight="120px"
                    background="bg-surface-secondary"
                    borderRadius="200"
                    style={{
                      overflow: "hidden",
                      border: "1px solid #e1e3e5",
                    }}
                  >
                    <img
                      src={
                        item.image ||
                        "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_medium.png"
                      }
                      alt={item.productTitle}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        objectPosition: "center",
                      }}
                    />
                  </Box>

                  {/* Product Info */}
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">
                      {item.productTitle}
                    </Text>
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="bodySm" tone="subdued">
                        SKU: {item.sku}
                      </Text>
                      <Badge tone={stockStatus}>{stockLabel}</Badge>
                    </InlineStack>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Enhanced Tab Buttons */}
            <ButtonGroup variant="segmented" fullWidth>
              <Button
                pressed={activeTab === "details"}
                onClick={() => setActiveTab("details")}
              >
                Details
              </Button>
              <Button
                pressed={activeTab === "variants"}
                onClick={() => setActiveTab("variants")}
              >
                Variants
              </Button>
            </ButtonGroup>

            {/* Details Tab Content */}
            {activeTab === "details" && (
              <BlockStack gap="400">
                {/* Stock Metrics Card */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingSm" as="h3">
                      Inventory Levels
                    </Text>
                    <Divider />

                    {/* Stock Grid */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, 1fr)",
                        gap: "16px",
                      }}
                    >
                      {/* On Hand */}
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">
                            On Hand
                          </Text>
                          <Text variant="heading2xl" as="p">
                            {item.onHand}
                          </Text>
                        </BlockStack>
                      </Box>

                      {/* Incoming */}
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">
                            Incoming
                          </Text>
                          <Text
                            variant="heading2xl"
                            as="p"
                            tone={item.incoming > 0 ? "success" : undefined}
                          >
                            {item.incoming}
                          </Text>
                        </BlockStack>
                      </Box>

                      {/* To Order */}
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">
                            To Order
                          </Text>
                          <Text variant="heading2xl" as="p">
                            {item.toOrder}
                          </Text>
                        </BlockStack>
                      </Box>
                    </div>
                  </BlockStack>
                </Card>

                {/* Location Card */}
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingSm" as="h3">
                      Location Information
                    </Text>
                    <Divider />
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={PackageIcon} tone="subdued" />
                      <Text variant="bodyMd" tone="subdued">
                        {item.locationId
                          ? item.locationId.split("/").pop()
                          : "No location assigned"}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Card>

                {/* Action Buttons */}
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingSm" as="h3">
                      Quick Actions
                    </Text>
                    <Divider />
                    <InlineStack gap="300">
                      <Button variant="primary">Adjust Stock</Button>
                      <Button>View History</Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </BlockStack>
            )}

            {/* Variants Tab Content */}
            {activeTab === "variants" && (
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm" as="h3">
                    Variant Details
                  </Text>
                  <Divider />
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric"]}
                    headings={["SKU", "On Hand", "Incoming"]}
                    rows={[[item.sku, item.onHand, item.incoming]]}
                  />
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Box>
      </div>

      {/* CSS Animations */}
      <style>
        {`
          @keyframes fadeIn {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
          
          @keyframes slideIn {
            from {
              transform: translateX(100%);
            }
            to {
              transform: translateX(0);
            }
          }
        `}
      </style>
    </>
  );
}