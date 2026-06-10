import * as React from "react"

import { cn } from "@/lib/utils"

type TextareaProps = React.ComponentProps<"textarea"> & { "data-no-case"?: boolean };

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  TextareaProps
>(({ className, onChange, "data-no-case": dataNoCase, ...props }, ref) => {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      // Skip transformation if data-no-case is present
      if (dataNoCase) {
        onChange?.(e);
        return;
      }

      const cursorStart = e.target.selectionStart;
    const cursorEnd = e.target.selectionEnd;
    
    e.target.value = e.target.value.toUpperCase();
    
    // Restore cursor position
    if (cursorStart !== null && cursorEnd !== null) {
        e.target.setSelectionRange(cursorStart, cursorEnd);
    }
    
    onChange?.(e);
  };

  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      onChange={handleChange}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
