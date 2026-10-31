export class DocumentPageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentPageLimitError";
  }
}
