export class DelvegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** User-supplied parameters are out of range or contradictory. */
export class ValidationError extends DelvegenError {}

/** Generation failed after exhausting its bounded retry budget. */
export class GenerationError extends DelvegenError {}

/** Export or import produced invalid data. */
export class ExportError extends DelvegenError {}
