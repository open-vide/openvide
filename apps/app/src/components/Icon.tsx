import React from "react";
import Feather from "@expo/vector-icons/Feather";
import { colors } from "../constants/colors";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

interface IconProps {
  name: FeatherIconName;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 20, color = colors.foreground }: IconProps): JSX.Element {
  return <Feather name={name} size={size} color={color} />;
}

export type { FeatherIconName };
