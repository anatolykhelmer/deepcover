/** Turns rows into columns: `ungroup([[1, 'a'], [2, 'b']])` → `[[1, 2], ['a', 'b']]`. */
export function ungroup<T>(rows: readonly (readonly T[])[]): T[][] {
  if (!rows || !rows.length) {
    return [];
  }
  const width = Math.max(...rows.map((row) => row.length));
  const columns: T[][] = [];
  for (let i = 0; i < width; i++) {
    columns.push(rows.map((row) => row[i]));
  }
  return columns;
}

/** Pairs same-index elements: `group([1, 2], ['a', 'b'])` → `[[1, 'a'], [2, 'b']]`. */
export function group<T>(...arrays: T[][]): T[][] {
  return ungroup(arrays);
}
