import React from 'react';
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";

const config = {
  high: {
    icon: ShieldCheck,
    label: "High confidence",
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10"
  },
  medium: {
    icon: ShieldAlert,
    label: "Medium confidence",
    className: "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/10"
  },
  low: {
    icon: ShieldQuestion,
    label: "Low confidence",
    className: "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/10"
  }
};

export default function ConfidenceBadge({ level }) {
  const { icon: Icon, label, className } = config[level] || config.medium;
  
  return (
    <Badge variant="outline" className={`font-body text-xs gap-1.5 ${className}`}>
      <Icon className="w-3 h-3" />
      {label}
    </Badge>
  );
}