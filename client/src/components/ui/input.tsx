import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputType = type || "text";
      // Skip transformation if data-no-case is present
      if (props["data-no-case"]) {
        onChange?.(e);
        return;
      }

      const allowedTypes = ["text", "email", "search", "url", "tel"];
      
      if (allowedTypes.includes(inputType)) {
        const cursorStart = e.target.selectionStart;
        const cursorEnd = e.target.selectionEnd;
        
        let newValue = e.target.value;
        if (inputType === "email") {
           newValue = newValue.toLowerCase();
        } else {
           newValue = newValue.toUpperCase();
        }
        
        e.target.value = newValue;
        
        // Restore cursor position to prevent jumping
        if (cursorStart !== null && cursorEnd !== null) {
            e.target.setSelectionRange(cursorStart, cursorEnd);
        }
      }
      
      onChange?.(e);
    };

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        onChange={handleChange}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
