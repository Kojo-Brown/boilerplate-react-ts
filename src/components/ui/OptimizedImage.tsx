import { useState, type ImgHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface OptimizedImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "loading" | "placeholder"
> {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  blurDataURL?: string;
  aspectRatio?: string;
  priority?: boolean;
  imgClassName?: string;
}

export function OptimizedImage({
  src,
  alt,
  width,
  height,
  blurDataURL,
  aspectRatio,
  priority = false,
  className,
  imgClassName,
  onLoad,
  onError,
  ...rest
}: OptimizedImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    setIsLoaded(true);
    onLoad?.(e);
  }

  function handleError(e: React.SyntheticEvent<HTMLImageElement>) {
    setHasError(true);
    onError?.(e);
  }

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{
        aspectRatio,
        width: width ? `${width}px` : undefined,
      }}
    >
      {blurDataURL && !isLoaded && !hasError && (
        <img
          src={blurDataURL}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
        />
      )}

      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-[var(--duration-slow)]",
          !isLoaded && !hasError ? "opacity-0" : "opacity-100",
          imgClassName,
        )}
        {...rest}
      />

      {hasError && (
        <div
          role="img"
          aria-label={`Failed to load: ${alt}`}
          className="absolute inset-0 flex items-center justify-center bg-[var(--color-muted)] text-[var(--color-muted-fg)]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8 opacity-50"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      )}
    </div>
  );
}
