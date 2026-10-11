import { WIDGET_SIZE_MAP, type DesktopItem } from '../store/layoutStore';

export interface GridPosition { column: number; row: number }
export interface GridBounds { columns: number; rows: number }

/** Capacity is based on a readable minimum cell size, not on the item count. */
export function getFreeGridBounds(width: number, height: number): GridBounds {
  const minCell = 56;
  const gap = 8;
  const availableWidth = Math.max(0, width - 16);
  const availableHeight = Math.max(0, height - (width >= 768 ? 64 : 32));
  return {
    columns: Math.max(4, Math.min(24, Math.floor((availableWidth + gap) / (minCell + gap)))),
    rows: Math.max(1, Math.floor((availableHeight + gap) / (minCell + gap))),
  };
}

export function gridSpan(item: DesktopItem) {
  return item.type === 'widget'
    ? WIDGET_SIZE_MAP[item.widgetSize && item.widgetSize in WIDGET_SIZE_MAP ? item.widgetSize : 'small']
    : { cols: 1, rows: 1 };
}

/** Keep saved cells fixed; fill unsaved or invalid cells into the remaining gaps. */
export function resolveFreeGrid(items: DesktopItem[], columns: number): Map<string, GridPosition> {
  const positions = new Map<string, GridPosition>();
  const occupied = new Set<string>();
  const fits = (column: number, row: number, cols: number, rows: number) => {
    if (column < 0 || row < 0 || column + cols > columns) return false;
    for (let y = row; y < row + rows; y++) {
      for (let x = column; x < column + cols; x++) {
        if (occupied.has(`${x},${y}`)) return false;
      }
    }
    return true;
  };
  const occupy = (item: DesktopItem, column: number, row: number) => {
    const { cols, rows } = gridSpan(item);
    positions.set(item.id, { column, row });
    for (let y = row; y < row + rows; y++) {
      for (let x = column; x < column + cols; x++) occupied.add(`${x},${y}`);
    }
  };

  for (const item of items) {
    const pos = item.gridPosition;
    if (!pos || !Number.isInteger(pos.column) || !Number.isInteger(pos.row)) continue;
    const { cols, rows } = gridSpan(item);
    if (fits(pos.column, pos.row, cols, rows)) occupy(item, pos.column, pos.row);
  }
  let cursorRow = 0;
  let cursorColumn = 0;
  for (const item of items) {
    if (positions.has(item.id)) continue;
    const { cols, rows } = gridSpan(item);
    for (let row = cursorRow; ; row++) {
      let placed = false;
      for (let column = row === cursorRow ? cursorColumn : 0; column <= columns - cols; column++) {
        if (!fits(column, row, cols, rows)) continue;
        occupy(item, column, row);
        cursorRow = row;
        cursorColumn = column + cols;
        if (cursorColumn >= columns) { cursorColumn = 0; cursorRow++; }
        placed = true;
        break;
      }
      if (placed) break;
    }
  }
  return positions;
}

export function canPlaceOnGrid(items: DesktopItem[], position: GridPosition, item: DesktopItem, columns: number): boolean {
  const { cols, rows } = gridSpan(item);
  if (position.column < 0 || position.row < 0 || position.column + cols > columns) return false;
  const placed = resolveFreeGrid(items, columns);
  return items.every(other => {
    const otherPos = placed.get(other.id)!;
    const otherSpan = gridSpan(other);
    return position.column + cols <= otherPos.column
      || otherPos.column + otherSpan.cols <= position.column
      || position.row + rows <= otherPos.row
      || otherPos.row + otherSpan.rows <= position.row;
  });
}

/** Place a widget and push every item it covers (and any resulting conflicts) downward. */
export function pushGridItemsDown(items: DesktopItem[], widget: DesktopItem, position: GridPosition, columns: number): Map<string, GridPosition> | null {
  const widgetSpan = gridSpan(widget);
  if (position.column < 0 || position.row < 0 || position.column + widgetSpan.cols > columns) return null;

  const positions = resolveFreeGrid(items, columns);
  const byId = new Map(items.map(item => [item.id, item]));
  const overlaps = (a: GridPosition, aItem: DesktopItem, b: GridPosition, bItem: DesktopItem) => {
    const aSpan = gridSpan(aItem);
    const bSpan = gridSpan(bItem);
    return a.column < b.column + bSpan.cols && b.column < a.column + aSpan.cols
      && a.row < b.row + bSpan.rows && b.row < a.row + aSpan.rows;
  };

  const moveDown = (id: string, minimumRow: number): void => {
    const item = byId.get(id)!;
    const old = positions.get(id)!;
    const span = gridSpan(item);
    positions.delete(id);
    let row = Math.max(old.row + 1, minimumRow);
    while (true) {
      const candidate = { column: old.column, row };
      if (overlaps(candidate, item, position, widget)) {
        row = position.row + widgetSpan.rows;
        continue;
      }
      const conflict = items.find(other => {
        const otherPos = positions.get(other.id);
        return otherPos && overlaps(candidate, item, otherPos, other);
      });
      if (conflict) {
        moveDown(conflict.id, row + span.rows);
        continue;
      }
      positions.set(id, candidate);
      return;
    }
  };

  const displaced = items
    .filter(item => overlaps(positions.get(item.id)!, item, position, widget))
    .sort((a, b) => {
      const aPos = positions.get(a.id)!;
      const bPos = positions.get(b.id)!;
      return bPos.row - aPos.row || bPos.column - aPos.column;
    });
  for (const item of displaced) {
    if (overlaps(positions.get(item.id)!, item, position, widget)) {
      moveDown(item.id, position.row + widgetSpan.rows);
    }
  }
  return positions;
}

