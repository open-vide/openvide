import React from "react";
import { Modal, Pressable, View } from "react-native";
import { GlassContainer } from "./GlassContainer";

export function SheetModal({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/30" onPress={onClose} />
        <GlassContainer variant="sheet" className="p-4 min-h-[200px]">
          {children}
        </GlassContainer>
      </View>
    </Modal>
  );
}
