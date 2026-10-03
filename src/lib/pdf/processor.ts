import type {
  ProcessInput,
  ProcessOutput,
  ProgressCallback,
} from "./types";

// Minimal base class for local PDF processors.
// Each tool subclasses this and implements `run`.
export abstract class BaseLocalProcessor {
  private progressValue = 0;
  private cancelledFlag = false;
  protected onProgress?: ProgressCallback;

  abstract run(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput>;

  getProgress(): number {
    return this.progressValue;
  }

  cancel(): void {
    this.cancelledFlag = true;
  }

  protected reset(): void {
    this.progressValue = 0;
    this.cancelledFlag = false;
  }

  protected report(progress: number, message?: string): void {
    this.progressValue = Math.min(100, Math.max(0, progress));
    this.onProgress?.(this.progressValue, message);
  }

  protected isCancelled(): boolean {
    return this.cancelledFlag;
  }

  protected ok(
    result: Blob | Blob[],
    filename: string | string[],
    metadata?: Record<string, unknown>
  ): ProcessOutput {
    return { success: true, result, filename, metadata };
  }

  protected fail(
    code: string,
    message: string,
    details?: string
  ): ProcessOutput {
    return { success: false, error: { code, message, details } };
  }
}
