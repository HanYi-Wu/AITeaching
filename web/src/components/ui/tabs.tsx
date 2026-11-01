import { useRef, type ComponentPropsWithoutRef } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../../lib/utils";
import { SelectionIndicator } from "../../design-system/SelectionIndicator";

const Tabs = TabsPrimitive.Root;

const TabsList = ({ className, children, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) => {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
  <TabsPrimitive.List
    ref={rootRef}
    className={cn(
      "or-tabs no-scrollbar inline-flex h-10 max-w-full items-center justify-start overflow-x-auto rounded-[12px] bg-[var(--or-block)] p-1 text-[var(--or-muted)] sm:justify-center",
      className,
    )}
    {...props}
  >
    <SelectionIndicator rootRef={rootRef} selector={'[data-state="active"]'} />
    {children}
  </TabsPrimitive.List>
);
};

const TabsTrigger = ({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      "or-tab inline-flex shrink-0 flex-1 items-center justify-center whitespace-nowrap rounded-[10px] px-3 py-1.5 text-sm sm:px-3.5 sm:text-[15px] font-medium transition-all duration-150 select-none",
      "data-[state=active]:bg-[var(--or-card)] data-[state=active]:text-[var(--or-text)] data-[state=active]:shadow-sm",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--or-focus)] focus-visible:ring-offset-1",
      className,
    )}
    {...props}
  />
);

const TabsContent = ({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content
    className={cn("mt-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--or-focus)] rounded-[12px]", className)}
    {...props}
  />
);

export { Tabs, TabsList, TabsTrigger, TabsContent };
