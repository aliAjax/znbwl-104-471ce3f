const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

function parsePaginationParams(query) {
  const page = Math.max(DEFAULT_PAGE, parseInt(query.page) || DEFAULT_PAGE);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(query.page_size) || DEFAULT_PAGE_SIZE)
  );
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

function buildPaginationResult(list, total, page, pageSize) {
  return {
    list,
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: Math.ceil(total / pageSize),
    },
  };
}

module.exports = {
  parsePaginationParams,
  buildPaginationResult,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
};
