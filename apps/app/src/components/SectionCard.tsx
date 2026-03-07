import React from "react";
import { Text } from "react-native";
import { GlassContainer } from "./GlassContainer";

export function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <GlassContainer variant="card" className="p-3.5 gap-2.5">
      <Text className="text-foreground font-bold text-base">{title}</Text>
      {children}
    </GlassContainer>
  );
}
