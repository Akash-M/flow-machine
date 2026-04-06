import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ComboboxOption {
  description?: string;
  keywords?: string[];
  label: string;
  value: string;
}

interface ComboboxProps {
  disabled?: boolean;
  id?: string;
  noResultsText?: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  value: string;
}

export function Combobox({
  disabled = false,
  id,
  noResultsText = 'No matches found.',
  onChange,
  options,
  placeholder = 'Search…',
  value
}: ComboboxProps) {
  const reactId = useId();
  const inputId = id ?? `combobox-${reactId}`;
  const listboxId = `${inputId}-listbox`;
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const [inputValue, setInputValue] = useState(selectedOption?.label ?? '');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedLabelRef = useRef(selectedOption?.label ?? '');

  useEffect(() => {
    selectedLabelRef.current = selectedOption?.label ?? '';
    setInputValue(selectedOption?.label ?? '');
  }, [selectedOption?.label]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = inputValue.trim().toLowerCase();

    if (!normalizedQuery) {
      return options;
    }

    return options.filter((option) => {
      const haystacks = [option.label, option.description ?? '', ...(option.keywords ?? [])];
      return haystacks.some((entry) => entry.toLowerCase().includes(normalizedQuery));
    });
  }, [inputValue, options]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveIndex((current) => {
      if (filteredOptions.length === 0) {
        return 0;
      }

      return Math.min(current, filteredOptions.length - 1);
    });
  }, [filteredOptions, isOpen]);

  function commitSelection(nextValue: string): void {
    const nextOption = options.find((option) => option.value === nextValue) ?? null;

    onChange(nextValue);
    setInputValue(nextOption?.label ?? '');
    setIsOpen(false);
    setActiveIndex(0);
  }

  function handleBlur(): void {
    window.setTimeout(() => {
      setInputValue(selectedLabelRef.current);
      setIsOpen(false);
    }, 0);
  }

  function handleFocus(): void {
    if (disabled) {
      return;
    }

    setIsOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (disabled) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();

      if (!isOpen) {
        setIsOpen(true);
        setActiveIndex(0);
        return;
      }

      setActiveIndex((current) => Math.min(current + 1, Math.max(filteredOptions.length - 1, 0)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();

      if (!isOpen) {
        setIsOpen(true);
        setActiveIndex(Math.max(filteredOptions.length - 1, 0));
        return;
      }

      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      if (!isOpen || filteredOptions.length === 0) {
        return;
      }

      event.preventDefault();
      commitSelection(filteredOptions[activeIndex]?.value ?? filteredOptions[0].value);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setInputValue(selectedOption?.label ?? '');
      setIsOpen(false);
    }
  }

  return (
    <div className={`combobox${disabled ? ' combobox--disabled' : ''}`}>
      <div className="combobox__input-shell">
        <input
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          autoComplete="off"
          className="input combobox__input"
          disabled={disabled}
          id={inputId}
          onBlur={handleBlur}
          onChange={(event) => {
            setInputValue(event.target.value);
            setIsOpen(true);
          }}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          value={inputValue}
        />
        <span aria-hidden="true" className="combobox__chevron">
          ▾
        </span>
      </div>

      {isOpen ? (
        <div className="combobox__menu" id={listboxId} role="listbox">
          {filteredOptions.length === 0 ? (
            <div className="combobox__empty">{noResultsText}</div>
          ) : (
            filteredOptions.map((option, index) => {
              const isActive = index === activeIndex;
              const isSelected = option.value === value;

              return (
                <button
                  className={`combobox__option${isActive ? ' combobox__option--active' : ''}${isSelected ? ' combobox__option--selected' : ''}`}
                  key={`${option.value || 'empty'}-${index}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commitSelection(option.value);
                  }}
                  type="button"
                >
                  <span className="combobox__option-label">{option.label}</span>
                  {option.description ? <span className="combobox__option-description">{option.description}</span> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}