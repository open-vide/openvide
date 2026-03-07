export class Redactor {
  private readonly patterns: RegExp[];

  constructor(values: string[]) {
    const candidates = Array.from(
      new Set(
        values
          .map((value) => value.trim())
          .filter((value) => value.length >= 2),
      ),
    );

    this.patterns = candidates.map((value) => {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(escaped, "g");
    });
  }

  redact(line: string): string {
    return this.patterns.reduce((acc, pattern) => acc.replace(pattern, "***REDACTED***"), line);
  }
}
