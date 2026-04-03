import { Box, Text, useInput } from "ink";
import { Overlay } from "../components/Overlay.js";
import { useTheme } from "../theme.js";

export interface PaletteItem {
  id: string;
  label: string;
  description: string;
}

interface Props {
  items: PaletteItem[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onChoose: (item: PaletteItem) => void;
}

export function CommandPalette({
  items,
  selectedIndex,
  onSelectedIndexChange,
  onChoose,
}: Props) {
  const { theme } = useTheme();
  const { colors } = theme;

  useInput((_, key) => {
    if (key.upArrow) {
      onSelectedIndexChange(Math.max(0, selectedIndex - 1));
      return;
    }

    if (key.downArrow) {
      onSelectedIndexChange(Math.min(items.length - 1, selectedIndex + 1));
      return;
    }

    if (key.return) {
      const item = items[selectedIndex];
      if (item) {
        onChoose(item);
      }
    }
  });

  return (
    <Overlay
      title="Command Palette"
      subtitle="Quick jump between views and shell actions. Use arrow keys and Enter."
    >
      <Box flexDirection="column" gap={0}>
        {items.map((item, index) => {
          const selected = index === selectedIndex;

          return (
            <Box
              key={item.id}
              paddingX={1}
              backgroundColor={selected ? colors.bgSelected : undefined}
              justifyContent="space-between"
            >
              <Box gap={1}>
                <Text color={selected ? colors.primary : colors.border}>
                  {selected ? ">" : " "}
                </Text>
                <Text color={selected ? colors.text : colors.text} bold={selected}>
                  {item.label}
                </Text>
              </Box>
              <Text color={colors.dimmed}>{item.description}</Text>
            </Box>
          );
        })}
      </Box>
    </Overlay>
  );
}
