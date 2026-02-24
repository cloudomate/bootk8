type Status =
  | 'pending' | 'idle'
  | 'pxe-booting' | 'installing' | 'deploying' | 'generating' | 'serving' | 'waiting'
  | 'ready' | 'complete'
  | 'error'

const styles: Record<string, string> = {
  pending:      'bg-gray-800 text-gray-400',
  idle:         'bg-gray-800 text-gray-400',
  'pxe-booting':'bg-yellow-900/50 text-yellow-300',
  installing:   'bg-blue-900/50 text-blue-300',
  deploying:    'bg-blue-900/50 text-blue-300',
  generating:   'bg-blue-900/50 text-blue-300',
  serving:      'bg-blue-900/50 text-blue-300',
  waiting:      'bg-yellow-900/50 text-yellow-300',
  ready:        'bg-green-900/50 text-green-300',
  complete:     'bg-green-900/50 text-green-300',
  error:        'bg-red-900/50 text-red-300',
}

const dots: Record<string, string> = {
  pending:      'bg-gray-600',
  idle:         'bg-gray-600',
  'pxe-booting':'bg-yellow-400 animate-pulse',
  installing:   'bg-blue-400 animate-pulse',
  deploying:    'bg-blue-400 animate-pulse',
  generating:   'bg-blue-400 animate-pulse',
  serving:      'bg-blue-400 animate-pulse',
  waiting:      'bg-yellow-400 animate-pulse',
  ready:        'bg-green-400',
  complete:     'bg-green-400',
  error:        'bg-red-400',
}

export default function StatusBadge({ status }: { status: Status | string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${
        styles[status] ?? 'bg-gray-800 text-gray-400'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dots[status] ?? 'bg-gray-600'}`} />
      {status}
    </span>
  )
}
