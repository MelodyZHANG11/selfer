import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ source }: { source: string }): JSX.Element {
  return (
    <div className="prose-selfer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h1 className="text-xl font-bold mt-4 mb-2" {...props} />,
          h2: (props) => (
            <h2 className="text-lg font-semibold mt-4 mb-2 text-neutral-200" {...props} />
          ),
          h3: (props) => <h3 className="font-semibold mt-3 mb-1 text-neutral-200" {...props} />,
          p: (props) => <p className="my-2 leading-relaxed" {...props} />,
          ul: (props) => <ul className="list-disc pl-5 my-2 space-y-1" {...props} />,
          ol: (props) => <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />,
          li: (props) => <li className="leading-relaxed" {...props} />,
          blockquote: (props) => (
            <blockquote
              className="border-l-2 border-neutral-700 pl-3 my-2 text-neutral-400 italic"
              {...props}
            />
          ),
          code: ({ className, children, ...rest }) => {
            const isBlock = /language-/.test(className ?? '') || String(children).includes('\n')
            if (isBlock) {
              return (
                <code
                  className={`block rounded bg-neutral-950/80 border border-neutral-800 p-2 overflow-x-auto text-xs whitespace-pre ${className ?? ''}`}
                  {...rest}
                >
                  {children}
                </code>
              )
            }
            return (
              <code
                className="rounded bg-neutral-800/80 px-1 py-0.5 text-[0.85em] font-mono"
                {...rest}
              >
                {children}
              </code>
            )
          },
          pre: ({ children }) => <pre className="my-2">{children}</pre>,
          a: (props) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:underline"
            />
          ),
          hr: () => <hr className="my-4 border-neutral-800" />,
          table: (props) => (
            <table className="my-2 border-collapse text-xs" {...props} />
          ),
          th: (props) => (
            <th
              className="border border-neutral-800 px-2 py-1 text-left bg-neutral-900"
              {...props}
            />
          ),
          td: (props) => <td className="border border-neutral-800 px-2 py-1" {...props} />
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
