import React from "react";
import Feather from "@expo/vector-icons/Feather";
import { useThemeColors } from "../constants/colors";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

interface IconProps {
  name: FeatherIconName;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 20, color }: IconProps): JSX.Element {
  const { foreground } = useThemeColors();
  return <Feather name={name} size={size} color={color ?? foreground} />;
}

export type { FeatherIconName };
