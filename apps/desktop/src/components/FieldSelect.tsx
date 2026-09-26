import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FieldOption = {
  value: string;
  label: string;
};

/** Shared shadcn dropdown — use this instead of native <select> everywhere. */
export function FieldSelect({
  value,
  onChange,
  placeholder,
  options,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: FieldOption[] | string[];
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const normalized: FieldOption[] = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  );
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={ariaLabel ?? placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {normalized.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
