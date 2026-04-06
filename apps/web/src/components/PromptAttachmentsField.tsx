import { ChangeEvent } from 'react';

import { PromptAttachmentDraft, formatPromptAttachmentSize, promptAttachmentInputAccept, readPromptAttachments } from '../lib/prompt-attachments';

interface PromptAttachmentsFieldProps {
  attachments: PromptAttachmentDraft[];
  errorMessage?: string | null;
  helperCopy?: string;
  onAttachmentsChange: (attachments: PromptAttachmentDraft[]) => void;
  onErrorMessageChange?: (message: string | null) => void;
}

export function PromptAttachmentsField({
  attachments,
  errorMessage = null,
  helperCopy,
  onAttachmentsChange,
  onErrorMessageChange
}: PromptAttachmentsFieldProps) {
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = event.target.files;

    if (!files || files.length === 0) {
      return;
    }

    const { attachments: nextAttachments, errors } = await readPromptAttachments(files);

    if (nextAttachments.length > 0) {
      const existingKeys = new Set(attachments.map((attachment) => `${attachment.name}:${attachment.size}:${attachment.type}`));
      const dedupedAttachments = nextAttachments.filter(
        (attachment) => !existingKeys.has(`${attachment.name}:${attachment.size}:${attachment.type}`)
      );

      onAttachmentsChange([...attachments, ...dedupedAttachments]);
    }

    onErrorMessageChange?.(errors.length > 0 ? errors.join(' ') : null);
    event.target.value = '';
  }

  return (
    <div className="prompt-attachments">
      <div className="prompt-attachments__toolbar toolbar-row toolbar-row--compact">
        <label className="button button--secondary file-trigger">
          Upload context files
          <input accept={promptAttachmentInputAccept} multiple onChange={(event) => void handleFileChange(event)} type="file" />
        </label>
        <p className="helper-copy">
          {helperCopy ?? 'Attach text files, PDFs, screenshots, and other supporting files so the model has more context.'}
        </p>
      </div>

      {attachments.length > 0 ? (
        <ul className="prompt-attachments__list">
          {attachments.map((attachment) => (
            <li className="prompt-attachments__item" key={attachment.id}>
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

      {errorMessage ? <p className="error-copy">{errorMessage}</p> : null}
    </div>
  );
}