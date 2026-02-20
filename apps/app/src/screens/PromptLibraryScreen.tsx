import React, { useLayoutEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  SectionList,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { SwipeableRow } from "../components/SwipeableRow";
import { Icon } from "../components/Icon";
import { cn } from "../lib/utils";
import { useThemeColors } from "../constants/colors";
import type { PromptTemplate } from "../core/types";
import type { RootStackParamList } from "../navigation/types";

type Category = PromptTemplate["category"];

const CATEGORY_LABELS: Record<Category, string> = {
  general: "General",
  debug: "Debug",
  review: "Review",
  refactor: "Refactor",
  test: "Test",
  custom: "Custom",
};

const CATEGORY_ORDER: Category[] = ["general", "debug", "review", "refactor", "test", "custom"];

type Props = NativeStackScreenProps<RootStackParamList, "PromptLibrarySheet">;

export function PromptLibraryScreen({ navigation }: Props): JSX.Element {
  const {
    promptTemplates,
    addPromptTemplate,
    updatePromptTemplate,
    deletePromptTemplate,
  } = useAppStore();

  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editorLabel, setEditorLabel] = useState("");
  const [editorPrompt, setEditorPrompt] = useState("");
  const [editorIcon, setEditorIcon] = useState("");
  const [editorCategory, setEditorCategory] = useState<Category>("custom");
  const { accent, dimmed } = useThemeColors();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => openEditor()}
          className="w-10 h-10 items-center justify-center active:opacity-80"
        >
          <Icon name="plus" size={24} color={accent} />
        </Pressable>
      ),
    });
  }, [navigation, accent]);

  const sections = CATEGORY_ORDER
    .map((cat) => ({
      title: CATEGORY_LABELS[cat],
      data: promptTemplates.filter((t) => t.category === cat),
    }))
    .filter((s) => s.data.length > 0);

  const openEditor = (template?: PromptTemplate): void => {
    if (template) {
      setEditingTemplate(template);
      setEditorLabel(template.label);
      setEditorPrompt(template.prompt);
      setEditorIcon(template.icon ?? "");
      setEditorCategory(template.category);
    } else {
      setEditingTemplate(null);
      setEditorLabel("");
      setEditorPrompt("");
      setEditorIcon("");
      setEditorCategory("custom");
    }
    setShowEditor(true);
  };

  const handleSaveEditor = (): void => {
    if (editorLabel.trim().length === 0 || editorPrompt.trim().length === 0) return;

    if (editingTemplate) {
      updatePromptTemplate(editingTemplate.id, {
        label: editorLabel.trim(),
        prompt: editorPrompt.trim(),
        icon: editorIcon.trim() || undefined,
        category: editorCategory,
      });
    } else {
      addPromptTemplate({
        label: editorLabel.trim(),
        prompt: editorPrompt.trim(),
        icon: editorIcon.trim() || undefined,
        category: editorCategory,
        sortOrder: promptTemplates.length,
      });
    }
    setShowEditor(false);
  };

  const handleDeleteTemplate = (id: string, label: string): void => {
    Alert.alert("Delete Prompt", `Delete "${label}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deletePromptTemplate(id) },
    ]);
  };

  const canSave = editorLabel.trim().length > 0 && editorPrompt.trim().length > 0;

  return (
    <View className="flex-1 bg-background">
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        renderSectionHeader={({ section }) => (
          <Text className="text-muted-foreground text-xs font-semibold uppercase tracking-wider mt-3 mb-1">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          const row = (
            <Pressable
              className="bg-card rounded-2xl p-3.5 border border-border active:opacity-80"
              onPress={() => {
                if (item.isBuiltIn) return;
                openEditor(item);
              }}
            >
              <View className="flex-row items-center gap-2">
                {item.icon && <Text className="text-base">{item.icon}</Text>}
                <Text className="text-foreground text-[15px] font-semibold flex-1" numberOfLines={1}>
                  {item.label}
                </Text>
                {item.isBuiltIn && (
                  <Icon name="lock" size={14} color={dimmed} />
                )}
              </View>
              <Text className="text-muted-foreground text-[13px] mt-1" numberOfLines={2}>
                {item.prompt}
              </Text>
            </Pressable>
          );

          if (item.isBuiltIn) {
            return row;
          }

          return (
            <SwipeableRow
              onDelete={() => handleDeleteTemplate(item.id, item.label)}
              confirmTitle="Delete Prompt"
              confirmMessage={`Delete "${item.label}"?`}
            >
              {row}
            </SwipeableRow>
          );
        }}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-20">
            <Text className="text-dimmed text-sm">No prompt templates yet</Text>
          </View>
        }
      />

      <Modal
        visible={showEditor}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowEditor(false)}
      >
        <View className="flex-1 bg-card p-5 gap-3">
          <View className="flex-row justify-between items-center mb-2">
            <Text className="text-foreground text-lg font-bold">
              {editingTemplate ? "Edit Prompt" : "New Prompt"}
            </Text>
            <Pressable onPress={() => setShowEditor(false)}>
              <Text className="text-accent text-base">Cancel</Text>
            </Pressable>
          </View>

          <Text className="text-muted-foreground text-[13px] font-semibold">Label</Text>
          <TextInput
            className="bg-muted rounded-2xl p-4 text-foreground text-[15px]"
            value={editorLabel}
            onChangeText={setEditorLabel}
            placeholder="e.g. Fix lint errors"
            placeholderTextColor={dimmed}
          />

          <Text className="text-muted-foreground text-[13px] font-semibold">Prompt</Text>
          <TextInput
            className="bg-muted rounded-2xl p-4 text-foreground text-[15px] min-h-[80px]"
            value={editorPrompt}
            onChangeText={setEditorPrompt}
            placeholder="The text sent to the AI tool..."
            placeholderTextColor={dimmed}
            multiline
            textAlignVertical="top"
          />

          <Text className="text-muted-foreground text-[13px] font-semibold">Icon (emoji)</Text>
          <TextInput
            className="bg-muted rounded-2xl p-4 text-foreground text-[15px] w-16"
            value={editorIcon}
            onChangeText={(t) => setEditorIcon(t.slice(0, 2))}
            placeholder=""
            placeholderTextColor={dimmed}
          />

          <Text className="text-muted-foreground text-[13px] font-semibold">Category</Text>
          <View className="flex-row flex-wrap gap-2">
            {CATEGORY_ORDER.map((cat) => (
              <Pressable
                key={cat}
                className={cn(
                  "px-3 py-2 rounded-lg border-2",
                  editorCategory === cat ? "border-accent bg-muted" : "border-transparent bg-muted",
                )}
                onPress={() => setEditorCategory(cat)}
              >
                <Text className={cn(
                  "text-[13px] font-semibold",
                  editorCategory === cat ? "text-accent" : "text-muted-foreground",
                )}>
                  {CATEGORY_LABELS[cat]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            className={cn("bg-accent rounded-full py-4 items-center mt-4", !canSave && "opacity-40")}
            onPress={handleSaveEditor}
            disabled={!canSave}
          >
            <Text className="text-white font-bold text-base">Save</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}
