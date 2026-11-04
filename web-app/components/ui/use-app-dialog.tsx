"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DialogKind = "confirm" | "alert" | "prompt";
type DialogValue = boolean | string | undefined;

interface DialogRequest {
  kind: DialogKind;
  message: string;
  title: string;
  inputLabel?: string;
  inputValue: string;
  placeholder?: string;
}

export function useAppDialog() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: DialogValue) => void) | null>(null);

  function show(next: DialogRequest): Promise<DialogValue> {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setRequest(next);
      setOpen(true);
    });
  }

  function finish(value: DialogValue) {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(false);
  }

  function confirm(message: string, title = "Please confirm"): Promise<boolean> {
    return show({ kind: "confirm", message, title, inputValue: "" }).then(Boolean);
  }

  function alert(message: string, title = "Notice"): Promise<void> {
    return show({ kind: "alert", message, title, inputValue: "" }).then(() => undefined);
  }

  function prompt(
    message: string,
    options: { title?: string; inputLabel?: string; placeholder?: string } = {},
  ): Promise<string | null> {
    return show({
      kind: "prompt",
      message,
      title: options.title ?? "Enter a value",
      inputLabel: options.inputLabel,
      placeholder: options.placeholder,
      inputValue: "",
    }).then((value) => (typeof value === "string" ? value : null));
  }

  const dialog = (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && open) finish(request?.kind === "alert" ? undefined : false);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader className="gap-2">
          <DialogTitle>{request?.title}</DialogTitle>
          <DialogDescription>{request?.message}</DialogDescription>
        </DialogHeader>
        {request?.kind === "prompt" && (
          <div className="mt-4 grid gap-2">
            {request.inputLabel && <Label htmlFor="app-dialog-input">{request.inputLabel}</Label>}
            <Input
              id="app-dialog-input"
              autoFocus
              value={request.inputValue}
              placeholder={request.placeholder}
              onChange={(event) =>
                setRequest((current) => current ? { ...current, inputValue: event.target.value } : current)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") finish(request.inputValue);
              }}
            />
          </div>
        )}
        <DialogFooter>
          {request?.kind !== "alert" && (
            <Button type="button" variant="outline" onClick={() => finish(false)}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            variant={request?.kind === "confirm" ? "destructive" : "default"}
            onClick={() =>
              finish(request?.kind === "confirm" ? true : request?.kind === "prompt" ? request.inputValue : undefined)
            }
          >
            {request?.kind === "confirm" ? "Confirm" : request?.kind === "prompt" ? "Continue" : "OK"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, alert, prompt, dialog };
}
