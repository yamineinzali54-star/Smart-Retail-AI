"use client"

import * as React from "react"
import { cn } from "cn"
import { localizeNode, translateDisplayText, useI18n } from "@/lib/i18n"

interface TablePaginationState {
  page: number
  pageSize: number
  rowCount: number
  setPage: React.Dispatch<React.SetStateAction<number>>
  setRowCount: React.Dispatch<React.SetStateAction<number>>
}

const TablePaginationContext = React.createContext<TablePaginationState | null>(null)

function getTableRows(children: React.ReactNode): React.ReactNode[] | null {
  const rows = React.Children.toArray(children).flatMap((child) => {
    if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.type === React.Fragment) {
      return getTableRows(child.props.children) ?? []
    }
    return [child]
  })
  return rows.every((row) => React.isValidElement(row) && row.type === TableRow)
    ? rows
    : null
}

function Table({ className, children, ...props }: React.ComponentProps<"table">) {
  const { locale } = useI18n()
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)
  const [rowCount, setRowCount] = React.useState(0)
  const totalPages = Math.max(1, Math.ceil(rowCount / pageSize))
  const context = React.useMemo(
    () => ({ page, pageSize, rowCount, setPage, setRowCount }),
    [page, pageSize, rowCount],
  )
  const localize = (value: string) => translateDisplayText(locale, value)

  return (
    <TablePaginationContext.Provider value={context}>
      <div
        data-slot="table-container"
        className="relative w-full overflow-x-auto rounded-lg border border-border bg-card"
      >
        <table
          data-slot="table"
          className={cn("w-full caption-bottom text-xs", className)}
          {...props}
        >
          {children}
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span>
            {localize("Showing")} {rowCount === 0 ? 0 : (page - 1) * pageSize + 1}
            –{Math.min(page * pageSize, rowCount)} {localize("of")} {rowCount}
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              {localize("Rows per page")}
              <select
                aria-label={localize("Rows per page")}
                className="h-7 border border-input bg-background px-1 text-foreground"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
              >
                {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="h-7 border border-input px-2 text-foreground disabled:opacity-40"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
            >
              {localize("Previous")}
            </button>
            <span className="min-w-12 text-center text-foreground">{page} / {totalPages}</span>
            <button
              type="button"
              className="h-7 border border-input px-2 text-foreground disabled:opacity-40"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
            >
              {localize("Next")}
            </button>
          </div>
        </div>
      </div>
    </TablePaginationContext.Provider>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, children, ...props }: React.ComponentProps<"tbody">) {
  const pagination = React.useContext(TablePaginationContext)
  const rows = getTableRows(children)
  React.useEffect(() => {
    pagination?.setRowCount(rows?.length ?? 0)
    pagination?.setPage((page) => Math.min(page, Math.max(1, Math.ceil((rows?.length ?? 0) / (pagination.pageSize || 1)))))
  }, [pagination, rows?.length])
  const visibleRows = pagination && rows
    ? rows.slice((pagination.page - 1) * pagination.pageSize, pagination.page * pagination.pageSize)
    : children

  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    >
      {visibleRows}
    </tbody>
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, children, ...props }: React.ComponentProps<"th">) {
  const { locale } = useI18n()
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-3 text-left align-middle font-medium whitespace-nowrap text-secondary-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    >
      {localizeNode(locale, children)}
    </th>
  )
}

function TableCell({ className, children, ...props }: React.ComponentProps<"td">) {
  const { locale } = useI18n()
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    >
      {localizeNode(locale, children)}
    </td>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
