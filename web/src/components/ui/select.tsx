import { Children, Fragment, isValidElement, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import "../../design-system/select.css";

type Option = { value: string; label: ReactNode; disabled?: boolean; group?: string };
const ITEM_VALUE_PREFIX = "v:";

function encodeOptionValue(value: string): string {
  return `${ITEM_VALUE_PREFIX}${value}`;
}

function decodeOptionValue(value: string): string {
  return value.startsWith(ITEM_VALUE_PREFIX) ? value.slice(ITEM_VALUE_PREFIX.length) : "";
}

function readOptions(children: ReactNode, group?: string, groupDisabled = false): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; label?: string; children?: ReactNode }>(child)) return [];
    if (child.type === "option") return [{ value: String(child.props.value ?? child.props.children ?? ""), label: child.props.children, disabled: Boolean(child.props.disabled || groupDisabled), group }];
    if (child.type === "optgroup") return readOptions(child.props.children, child.props.label, Boolean(child.props.disabled || groupDisabled));
    if (child.type === Fragment) return readOptions(child.props.children, group, groupDisabled);
    return [];
  });
}

type SelectProps = Omit<ComponentPropsWithoutRef<typeof Primitive.Trigger>, "value" | "defaultValue" | "onChange" | "children"> & {
  value?: string | number;
  onValueChange: (value: string) => void;
  required?: boolean;
  children: ReactNode;
};

/** Shared application select; option values remain the values used by each form. */
export function Select({ value, onValueChange, children, className = "", disabled, required, ...triggerProps }: SelectProps) {
  const options = readOptions(children);
  const selected = String(value ?? "");
  const label = options.find((option) => option.value === selected)?.label ?? "—";
  const primitiveValue = selected === "" ? "" : encodeOptionValue(selected);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const groups = [...new Set(options.map((option) => option.group))];
  const changeValue = (next: string) => {
    setInvalid(false);
    onValueChange(decodeOptionValue(next));
  };
  const renderItem = (option: Option) => (
    <Primitive.Item key={option.value} value={encodeOptionValue(option.value)} data-value={option.value} disabled={option.disabled} className="or-select-item">
      <span className="or-select-check" aria-hidden="true">{option.value === selected ? <Check size={16} /> : null}</span>
      <Primitive.ItemText>{option.label}</Primitive.ItemText>
    </Primitive.Item>
  );
  return (
    <>
      <Primitive.Root value={primitiveValue} onValueChange={changeValue} disabled={disabled} onOpenChange={(open) => { if (open) setOpened(true); }}>
        <Primitive.Trigger
          {...triggerProps}
          ref={triggerRef}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          className={`or-select-trigger ${className}`}
        >
          <span className="or-select-balance" aria-hidden="true" />
          <Primitive.Value placeholder={label} aria-hidden="true">{label}</Primitive.Value>
          <Primitive.Icon className="or-select-arrow"><ChevronDown size={16} /></Primitive.Icon>
        </Primitive.Trigger>
        {opened ? <Primitive.Portal>
          <Primitive.Content className="or-select-content" data-or-select-content position="popper" align="start" sideOffset={6} collisionPadding={12}
            onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <Primitive.ScrollUpButton className="or-select-scroll"><ChevronUp size={16} /></Primitive.ScrollUpButton>
            <Primitive.Viewport className="or-select-viewport">
              {groups.map((group) => group === undefined
                ? options.filter((option) => option.group === undefined).map(renderItem)
                : <Primitive.Group key={group}>
                    <Primitive.Label className="or-select-label">{group}</Primitive.Label>
                    {options.filter((option) => option.group === group).map(renderItem)}
                  </Primitive.Group>)}
            </Primitive.Viewport>
            <Primitive.ScrollDownButton className="or-select-scroll"><ChevronDown size={16} /></Primitive.ScrollDownButton>
          </Primitive.Content>
        </Primitive.Portal> : null}
      </Primitive.Root>
      {required ? <select
        className="or-select-validation"
        aria-hidden="true"
        tabIndex={-1}
        required
        disabled={disabled}
        value={selected}
        onChange={(event) => changeValue(event.target.value)}
        onInvalid={(event) => { event.preventDefault(); setInvalid(true); triggerRef.current?.focus(); }}
      >{children}</select> : null}
    </>
  );
}
