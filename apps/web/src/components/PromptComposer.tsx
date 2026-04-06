import {
  ChangeEvent,
  DragEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react';

import {
  PromptAttachmentDraft,
  formatPromptAttachmentSize,
  hasImagePromptAttachments,
  mergePromptAttachmentDrafts,
  promptAttachmentInputAccept,
  readPromptAttachments
} from '../lib/prompt-attachments';

interface PromptComposerProps {
  attachments: PromptAttachmentDraft[];
  helperCopy?: string;
  id?: string;
  label: string;
  maxHeight?: number;
  minRows?: number;
  onAttachmentsChange: (attachments: PromptAttachmentDraft[]) => void;
  onBlockingStateChange?: (isBlocked: boolean) => void;
  onChange: (value: string) => void;
  placeholder?: string;
  selectedModelName?: string | null;
  selectedModelSupportsImages?: boolean | null;
  value: string;
}

function isFileDrag(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function imageAttachmentErrorMessage(selectedModelName: string | null | undefined): string {
  return selectedModelName
    ? `${selectedModelName} does not support image attachments. Remove the image files or switch to a vision-capable model in Settings.`
    : 'The selected model does not support image attachments. Remove the image files or switch to a vision-capable model in Settings.';
}

export function PromptComposer({
  attachments,
  helperCopy,
  id,
  label,
  maxHeight = 260,
  minRows = 4,
  onAttachmentsChange,
  onBlockingStateChange,
  onChange,
  placeholder,
  selectedModelName = null,
  selectedModelSupportsImages = null,
  value
}: PromptComposerProps) {
  const generatedId = useId();
  const composerId = id ?? `prompt-composer-${generatedId}`;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const appliedHeightRef = useRef(0);
  const dragDepthRef = useRef(0);
  const [fileReadError, setFileReadError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [manualHeight, setManualHeight] = useState<number | null>(null);
  const hasUnsupportedImages = selectedModelSupportsImages === false && hasImagePromptAttachments(attachments);
  const blockingErrorMessage = hasUnsupportedImages ? imageAttachmentErrorMessage(selectedModelName) : null;
  const combinedErrorMessage = [blockingErrorMessage, fileReadError].filter(Boolean).join(' ') || null;

  useEffect(() => {
    onBlockingStateChange?.(Boolean(blockingErrorMessage));
  }, [blockingErrorMessage, onBlockingStateChange]);

  useEffect(() => {
    if (attachments.length === 0 && fileReadError) {
      setFileReadError(null);
    }
  }, [attachments.length, fileReadError]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea || typeof window === 'undefined') {
      return;
    }

    const computedStyle = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 24;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const borderTop = Number.parseFloat(computedStyle.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(computedStyle.borderBottomWidth) || 0;
    const minHeight = lineHeight * minRows + paddingTop + paddingBottom + borderTop + borderBottom;

    textarea.style.height = 'auto';

    const contentHeight = Math.max(minHeight, textarea.scrollHeight);
    const nextHeight = Math.min(maxHeight, Math.max(manualHeight ?? 0, contentHeight));

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > nextHeight ? 'auto' : 'hidden';
    appliedHeightRef.current = nextHeight;
  }, [manualHeight, maxHeight, minRows, value]);

  function handleTextareaResizeCommit(): void {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    const measuredHeight = Math.round(textarea.getBoundingClientRect().height);

    if (Math.abs(measuredHeight - appliedHeightRef.current) < 2) {
      return;
    }

    setManualHeight(measuredHeight);
  }

  async function handleFiles(files: FileList | File[]): Promise<void> {
    const { attachments: nextAttachments, errors } = await readPromptAttachments(files);

    if (nextAttachments.length > 0) {
      onAttachmentsChange(mergePromptAttachmentDrafts(attachments, nextAttachments));
    }

    setFileReadError(errors.length > 0 ? errors.join(' ') : null);
  }

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = event.target.files;

    if (files && files.length > 0) {
      await handleFiles(files);
    }

    event.target.value = '';
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>): void {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);

    if (event.dataTransfer.files.length > 0) {
      void handleFiles(event.dataTransfer.files);
    }
  }

  return (
    <div className="prompt-composer">
      <div className="form-field form-field--full">
        <label htmlFor={composerId}>{label}</label>

        <div
          className={`prompt-composer__surface${isDragActive ? ' prompt-composer__surface--drag-active' : ''}${blockingErrorMessage ? ' prompt-composer__surface--blocked' : ''}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <textarea
            className="textarea prompt-composer__textarea"
            id={composerId}
            onChange={(event) => onChange(event.target.value)}
            onMouseUp={handleTextareaResizeCommit}
            onTouchEnd={handleTextareaResizeCommit}
            placeholder={placeholder}
            ref={textareaRef}
            rows={minRows}
            style={{ maxHeight }}
            value={value}
          />

          <div className="prompt-composer__dropzone">
            <div className="prompt-composer__dropzone-copy">
              <strong>{isDragActive ? 'Drop files to attach them' : 'Drag and drop context files here'}</strong>
              <p>{helperCopy ?? 'Attach docs, screenshots, PDFs, or source files to ground the model in the exact context you are working from.'}</p>
            </div>

            <label className="button button--secondary file-trigger prompt-composer__file-button">
              Browse files
              <input accept={promptAttachmentInputAccept} multiple onChange={(event) => void handleFileInputChange(event)} type="file" />
            </label>
          </div>
        </div>
      </div>

      {attachments.length > 0 ? (
        <ul className="prompt-composer__attachments">
          {attachments.map((attachment) => (
            <li className="prompt-composer__attachment" key={attachment.id}>
              <div>
                <strong>{attachment.name}</strong>
                <p>
                  {attachment.type} · {formatPromptAttachmentSize(attachment.size)}
                </p>
              </div>
              <button
                className="button button--ghost"
                onClick={() => onAttachmentsChange(attachments.filter((entry) => entry.id !== attachment.id))}
                type="button"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {combinedErrorMessage ? <p className="error-copy">{combinedErrorMessage}</p> : null}
    </div>
  );
}