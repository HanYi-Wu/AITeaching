import {
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type CompositionEvent,
  type CompositionEventHandler,
  type FocusEvent,
  type FocusEventHandler,
} from "react";

/**
 * Buffers IME composition locally via an uncontrolled DOM ref so pinyin keystrokes
 * never trigger parent state updates or controlled `.value` resets mid-composition.
 */
export function useImeTextField<T extends HTMLInputElement | HTMLTextAreaElement>(
  value: string,
  onValueChange: (next: string) => void,
  handlers?: {
    onCompositionStart?: CompositionEventHandler<T>;
    onCompositionEnd?: CompositionEventHandler<T>;
    onBlur?: FocusEventHandler<T>;
  },
) {
  const ref = useRef<T>(null);
  const composingRef = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (composingRef.current) {
      if (el.ownerDocument.activeElement === el) return;
      composingRef.current = false;
    }
    if (el.value !== value) {
      el.value = value;
    }
  }, [value]);

  return {
    ref,
    defaultValue: value,
    onCompositionStart: (e: CompositionEvent<T>) => {
      composingRef.current = true;
      handlers?.onCompositionStart?.(e);
    },
    onCompositionEnd: (e: CompositionEvent<T>) => {
      composingRef.current = false;
      onValueChange(e.currentTarget.value);
      handlers?.onCompositionEnd?.(e);
    },
    onChange: (e: ChangeEvent<T>) => {
      if (composingRef.current || Boolean((e.nativeEvent as { isComposing?: boolean } | null)?.isComposing)) {
        return;
      }
      onValueChange(e.currentTarget.value);
    },
    onBlur: (e: FocusEvent<T>) => {
      composingRef.current = false;
      if (e.currentTarget.value !== value) {
        onValueChange(e.currentTarget.value);
      }
      handlers?.onBlur?.(e);
    },
  };
}

export type ImeInputProps = Omit<ComponentPropsWithoutRef<"input">, "value" | "defaultValue" | "onChange"> & {
  value: string;
  onValueChange: (next: string) => void;
};

/** Text input that keeps pinyin/CJK IME composition local until commit or blur. */
export function ImeInput({ value, onValueChange, onCompositionStart, onCompositionEnd, onBlur, ...rest }: ImeInputProps) {
  const fieldProps = useImeTextField<HTMLInputElement>(value, onValueChange, {
    onCompositionStart,
    onCompositionEnd,
    onBlur,
  });
  return <input {...rest} {...fieldProps} />;
}

export type ImeTextareaProps = Omit<ComponentPropsWithoutRef<"textarea">, "value" | "defaultValue" | "onChange"> & {
  value: string;
  onValueChange: (next: string) => void;
};

/** Textarea that keeps pinyin/CJK IME composition local until commit or blur. */
export function ImeTextarea({ value, onValueChange, onCompositionStart, onCompositionEnd, onBlur, ...rest }: ImeTextareaProps) {
  const fieldProps = useImeTextField<HTMLTextAreaElement>(value, onValueChange, {
    onCompositionStart,
    onCompositionEnd,
    onBlur,
  });
  return <textarea {...rest} {...fieldProps} />;
}
