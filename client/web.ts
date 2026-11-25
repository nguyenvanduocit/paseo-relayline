import { Platform } from "react-native";
import { maxBackupSize } from "../shared/contracts";

interface BackupFile {
  size: number;
  text(): Promise<string>;
}
interface FileInput {
  type: string;
  accept: string;
  files: ArrayLike<BackupFile> | null;
  style: { display: string };
  addEventListener(event: "change" | "cancel", listener: () => void, options: { once: boolean }): void;
  click(): void;
  remove(): void;
}
interface FileLink {
  href: string;
  download: string;
  click(): void;
  remove(): void;
}
declare const document: {
  createElement(tag: "input"): FileInput;
  createElement(tag: "a"): FileLink;
  body: { appendChild(element: FileInput | FileLink): void };
};
declare const window: {
  Blob: new (parts: string[], options: { type: string }) => object;
  URL: { createObjectURL(data: object): string; revokeObjectURL(url: string): void };
};

export function canUseBackupFiles(): boolean {
  return Platform.OS === "web";
}

export function downloadBackup(backup: string) {
  if (!canUseBackupFiles()) return;
  const url = window.URL.createObjectURL(new window.Blob([backup], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `relayline-${new Date().toISOString().slice(0, 10)}.backup.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 1_000);
}

export function pickBackup(): Promise<string | null> {
  if (!canUseBackupFiles()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("cancel", () => { input.remove(); resolve(null); }, { once: true });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) resolve(null);
      else if (file.size > maxBackupSize) reject(new Error("The backup is too large."));
      else void file.text().then(resolve, reject);
    }, { once: true });
    input.click();
  });
}
