import { Children, Fragment, isValidElement, useEffect, useRef, useState, type AnimationEvent as ReactAnimationEvent, type ComponentPropsWithoutRef, type ReactNode, type SyntheticEvent } from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import "../../design-system/select.css";

type Option = { value: string; label: ReactNode; disabled?: boolean; group?: string };
const ITEM_VALUE_PREFIX = "v:";
// Keep the portal mounted long enough for select.css's close animation to run.
// The timer is also the fallback for reduced-motion/browser paths where no
// animationend event is delivered.
const SELECT_CLOSE_FALLBACK_MS = 180;

function encodeOptionValue(value: string): string {
  return `${ITEM_VALUE_PREFIX}${value}`;
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
  emptyLabel?: ReactNode;
  /** Keep nested dialog menus inside its focus scope without changing popup geometry. */
  portalContainer?: HTMLElement | null;
  children: ReactNode;
};

/** Shared application select; option values remain the values used by each form. */
export function Select({ value, onValueChange, children, className = "", disabled, required, emptyLabel = "暂无可选项", portalContainer, ...triggerProps }: SelectProps) {
  const options = readOptions(children);
  const selected = String(value ?? "");
  const label = options.find((option) => option.value === selected)?.label ?? "—";
  const primitiveValue = selected === "" ? "" : encodeOptionValue(selected);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(false);
  const [closing, setClosing] = useState(false);
  const openRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const closeFocusTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const [invalid, setInvalid] = useState(false);
  const groups = [...new Set(options.map((option) => option.group))];
  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    if (closeFocusTimerRef.current !== null) window.clearTimeout(closeFocusTimerRef.current);
  }, []);
  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const handleOpenChange = (open: boolean) => {
    openRef.current = open;
    if (open) {
      clearCloseTimer();
      if (closeFocusTimerRef.current !== null) {
        window.clearTimeout(closeFocusTimerRef.current);
        closeFocusTimerRef.current = null;
      }
      closingRef.current = false;
      setClosing(false);
      if (contentRef.current) {
        contentRef.current.inert = false;
        contentRef.current.removeAttribute("aria-hidden");
      }
      setOpened(true);
      return;
    }
    // Radix applies data-state="closed" to Content. Keep the subtree alive
    // until its CSS animation ends, then release the hooks/portal completely.
    closingRef.current = true;
    setClosing(true);
    clearCloseTimer();
    if (closeFocusTimerRef.current !== null) window.clearTimeout(closeFocusTimerRef.current);
    // FocusScope releases its focus trap after the close state commits. Restore
    // focus on the next task, before the exit animation finishes.
    closeFocusTimerRef.current = window.setTimeout(() => {
      closeFocusTimerRef.current = null;
      if (openRef.current) return;
      triggerRef.current?.focus({ preventScroll: true });
      if (contentRef.current) {
        contentRef.current.inert = true;
        contentRef.current.setAttribute("aria-hidden", "true");
      }
    }, 0);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      if (!openRef.current) {
        closingRef.current = false;
        setClosing(false);
        setOpened(false);
      }
    }, SELECT_CLOSE_FALLBACK_MS);
  };
  const handleContentAnimationEnd = (event: ReactAnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || openRef.current || event.animationName !== "or-select-close") return;
    clearCloseTimer();
    closingRef.current = false;
    setClosing(false);
    setOpened(false);
  };
  const blockClosingInteraction = (event: SyntheticEvent<HTMLDivElement>) => {
    if (!closingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const changeValue = (next: string) => {
    // Radix's hidden form select can emit an empty value before its items mount.
    if (!next.startsWith(ITEM_VALUE_PREFIX)) return;
    setInvalid(false);
    onValueChange(next.slice(ITEM_VALUE_PREFIX.length));
  };
  const renderItem = (option: Option) => (
    <Primitive.Item key={option.value} value={encodeOptionValue(option.value)} data-value={option.value} disabled={option.disabled} className="or-select-item">
      <span className="or-select-check" aria-hidden="true">{option.value === selected ? <Check size={16} /> : null}</span>
      <Primitive.ItemText>{option.label}</Primitive.ItemText>
    </Primitive.Item>
  );
  return (
    <>
      <Primitive.Root value={primitiveValue} onValueChange={changeValue} disabled={disabled} onOpenChange={handleOpenChange}>
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
        {opened ? <Primitive.Portal container={portalContainer ?? undefined}>
          <Primitive.Content ref={contentRef} className="or-select-content" data-or-select-content position="popper" align="start" sideOffset={6} collisionPadding={12}
            style={{ pointerEvents: closing ? "none" : "auto" }}
            onPointerDownCapture={blockClosingInteraction} onPointerUpCapture={blockClosingInteraction}
            onClickCapture={blockClosingInteraction} onKeyDownCapture={blockClosingInteraction}
            onAnimationEnd={handleContentAnimationEnd}
            onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <Primitive.ScrollUpButton className="or-select-scroll"><ChevronUp size={16} /></Primitive.ScrollUpButton>
            <Primitive.Viewport className="or-select-viewport">
              {options.length === 0 ? (
                <Primitive.Item value="or-select-empty-state" disabled className="or-select-item or-select-empty">
                  <span className="or-select-check" aria-hidden="true" />
                  <Primitive.ItemText>{emptyLabel}</Primitive.ItemText>
                </Primitive.Item>
              ) : groups.map((group) => group === undefined
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
        onChange={(event) => changeValue(encodeOptionValue(event.target.value))}
        onInvalid={(event) => { event.preventDefault(); setInvalid(true); triggerRef.current?.focus(); }}
      >{children}</select> : null}
    </>
  );
}
