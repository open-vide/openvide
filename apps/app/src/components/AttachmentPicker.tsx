import React from "react";
import { Modal, Pressable, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Icon } from "./Icon";
import { useThemeColors } from "../constants/colors";
import type { Attachment } from "../core/attachmentHandler";
import { newAttachmentId, canInline } from "../core/attachmentHandler";

interface AttachmentPickerProps {
  visible: boolean;
  onClose: () => void;
  onAttach: (attachment: Attachment) => void;
}

export function AttachmentPicker({ visible, onClose, onAttach }: AttachmentPickerProps): JSX.Element {
  const { mutedForeground } = useThemeColors();

  const handlePickImage = async (): Promise<void> => {
    onClose();
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 0.8,
      allowsMultipleSelection: false,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0]!;
    onAttach({
      id: newAttachmentId(),
      name: asset.fileName ?? `image_${Date.now()}.jpg`,
      uri: asset.uri,
      size: asset.fileSize ?? 0,
      mimeType: asset.mimeType ?? "image/jpeg",
      isInlinable: false,
    });
  };

  const handlePickFile = async (): Promise<void> => {
    onClose();
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0]!;
    const size = asset.size ?? 0;
    const mimeType = asset.mimeType ?? "application/octet-stream";
    const att: Attachment = {
      id: newAttachmentId(),
      name: asset.name,
      uri: asset.uri,
      size,
      mimeType,
      isInlinable: false,
    };
    att.isInlinable = canInline(att);
    onAttach(att);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 justify-end" onPress={onClose}>
        <Pressable className="bg-card rounded-t-2xl" onPress={(e) => e.stopPropagation()}>
          <View className="w-10 h-1 bg-muted rounded-full self-center mt-3" />
          <View className="p-4 gap-1">
            <Pressable
              className="flex-row items-center gap-3 p-3.5 rounded-xl active:opacity-80 active:bg-muted"
              onPress={handlePickImage}
            >
              <View className="w-10 h-10 rounded-full bg-muted items-center justify-center">
                <Icon name="image" size={20} color={mutedForeground} />
              </View>
              <View>
                <Text className="text-foreground text-[15px] font-semibold">Photo / Video</Text>
                <Text className="text-muted-foreground text-xs">Pick from camera roll</Text>
              </View>
            </Pressable>
            <Pressable
              className="flex-row items-center gap-3 p-3.5 rounded-xl active:opacity-80 active:bg-muted"
              onPress={handlePickFile}
            >
              <View className="w-10 h-10 rounded-full bg-muted items-center justify-center">
                <Icon name="file" size={20} color={mutedForeground} />
              </View>
              <View>
                <Text className="text-foreground text-[15px] font-semibold">File</Text>
                <Text className="text-muted-foreground text-xs">Browse device storage</Text>
              </View>
            </Pressable>
          </View>
          <View className="h-8" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
