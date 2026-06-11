import React from 'react';
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ConfidenceBadge from './ConfidenceBadge';

export default function InsightSection({ title, icon: Icon, data, index, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 * (index + 1) }}
    >
      <Card className="bg-card border-border hover:border-primary/20 transition-colors duration-300">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <CardTitle className="font-heading text-lg text-foreground">
                {title}
              </CardTitle>
            </div>
            {data?.confidence && <ConfidenceBadge level={data.confidence} />}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {data?.finding && (
            <p className="font-body text-sm text-foreground/85 leading-relaxed">
              {data.finding}
            </p>
          )}

          {children}

          {data?.data_basis && (
            <div className="mt-4 pt-4 border-t border-border/50">
              <p className="text-xs font-body text-muted-foreground">
                <span className="font-medium text-muted-foreground/80">Data basis:</span>{' '}
                {data.data_basis}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}