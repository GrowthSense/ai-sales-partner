export interface PaginationQuery {
  page?: number;    // default 1
  limit?: number;   // default 20, max 100
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
