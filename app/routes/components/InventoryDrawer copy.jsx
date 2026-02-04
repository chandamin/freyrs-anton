import {
  Modal,
  Thumbnail,
  BlockStack,
  Text,
  Tabs,
  Card,
  InlineStack,
  Badge,
  Box,
  Divider,
  Button,
  Icon
} from "@shopify/polaris";
import { ImageIcon, PackageIcon } from "@shopify/polaris-icons";

export default function InventoryDrawer({ 
  open, 
  item, 
  activeTab, 
  setActiveTab, 
  onClose 
}) {
  if (!item) return null;

  const tabs = [
    { id: "details", content: "Details" },
    { id: "variants", content: "Variants" }
  ];

  const stockStatus = item.onHand > 0 ? "success" : item.incoming > 0 ? "attention" : "critical";
  const stockLabel = item.onHand > 0 ? "In Stock" : item.incoming > 0 ? "Low Stock" : "Out of Stock";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="View Stock"
      large
    >
      <Modal.Section>
        <BlockStack gap="500">
          {/* Product Header Card */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="400" blockAlign="center">
                  {item.image ? (
                    <Thumbnail
                      source={item.image}
                      alt={item.productTitle}
                      size="large"
                    />
                  ) : (
                    <div style={{
                      width: 80,
                      height: 80,
                      background: '#f6f6f7',
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Icon source={ImageIcon} tone="subdued" />
                    </div>
                  )}
                  
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">
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
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Tabs */}
          <Tabs
            tabs={tabs}
            selected={tabs.findIndex(tab => tab.id === activeTab)}
            onSelect={(index) => setActiveTab(tabs[index].id)}
          />

          {/* Tab Content */}
          {activeTab === "details" && (
            <Card>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h3">
                  Inventory Details
                </Text>
                <Divider />
                
                {/* Stock Metrics */}
                <InlineStack gap="600" wrap={false}>
                  <Box width="33%">
                    <BlockStack gap="200">
                      <Text variant="bodyMd" tone="subdued">
                        On Hand
                      </Text>
                      <Text variant="heading2xl" as="p">
                        {item.onHand}
                      </Text>
                    </BlockStack>
                  </Box>
                  
                  <Box width="33%">
                    <BlockStack gap="200">
                      <Text variant="bodyMd" tone="subdued">
                        Incoming
                      </Text>
                      <Text variant="heading2xl" as="p" tone={item.incoming > 0 ? "success" : undefined}>
                        {item.incoming}
                      </Text>
                    </BlockStack>
                  </Box>
                  
                  <Box width="33%">
                    <BlockStack gap="200">
                      <Text variant="bodyMd" tone="subdued">
                        To Order
                      </Text>
                      <Text variant="heading2xl" as="p">
                        {item.toOrder}
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineStack>

                <Divider />

                {/* Location Info */}
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h4">
                    Location Information
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={PackageIcon} tone="subdued" />
                    <Text variant="bodyMd" tone="subdued">
                      {item.locationId ? 
                        item.locationId.split('/').pop() : 
                        'No location assigned'
                      }
                    </Text>
                  </InlineStack>
                </BlockStack>

                {/* Quick Actions */}
                <Divider />
                <InlineStack gap="300">
                  <Button>Adjust Stock</Button>
                  <Button>View History</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          )}

          {activeTab === "variants" && (
            <Card>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h3">
                  Variant Information
                </Text>
                <Divider />
                <Text variant="bodyMd" tone="subdued">
                  Variant details would appear here
                </Text>
              </BlockStack>
            </Card>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}