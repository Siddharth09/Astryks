export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-ink/10 ${className}`} />;
}

export function SkeletonCircle({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-full bg-ink/10 ${className}`} />;
}

// Mimics the shape of a PostCard while a post's data is still loading.
export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-ink/10 bg-white overflow-hidden">
          <div className="flex items-center gap-3 p-4">
            <SkeletonCircle className="w-9 h-9" />
            <div className="flex-1 space-y-2">
              <SkeletonBar className="h-3 w-28" />
              <SkeletonBar className="h-2.5 w-16" />
            </div>
          </div>
          <SkeletonBar className="w-full aspect-[4/3] rounded-none" />
        </div>
      ))}
    </div>
  );
}

// Mimics the subject-circle picker on the Learn page while subjects are loading.
export function SubjectsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex gap-4 flex-wrap">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCircle key={i} className="w-24 h-24" />
      ))}
    </div>
  );
}
