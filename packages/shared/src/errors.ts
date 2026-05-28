export class DomainError extends Error {
  constructor(public code: string, message: string, public override cause?: unknown) {
    super(message);
    this.name = "DomainError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, public field?: string) {
    super("VALIDATION_ERROR", message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} ${id} not found`);
    this.name = "NotFoundError";
  }
}

export class OutOfStockError extends DomainError {
  constructor(sku: string) {
    super("OUT_OF_STOCK", `SKU ${sku} sem estoque disponível`);
    this.name = "OutOfStockError";
  }
}

export class TenantContextError extends DomainError {
  constructor() {
    super("NO_TENANT_CONTEXT", "Operação exige contexto de tenant. Use withTenant().");
    this.name = "TenantContextError";
  }
}
