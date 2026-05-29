/**
 * CustomSelect
 * Wraps a native <select> with a custom trigger + dropdown menu while keeping
 * the original element in the DOM as the source of truth for `.value` and as
 * the dispatcher of `change` events. Existing code that reads/writes
 * `select.value` or assigns `select.onchange` continues to work unchanged.
 *
 * The native value-setter is monkey-patched per instance so programmatic
 * `select.value = X` updates also refresh the visible label without forcing
 * call sites to dispatch a manual event.
 */

const VALUE_DESCRIPTOR = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

export function enhanceSelect(selectEl) {
    if (!selectEl || selectEl.dataset.csEnhanced === 'true') return;
    selectEl.dataset.csEnhanced = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';
    // Preserve any layout-affecting classes the original had (e.g. width hints).
    if (selectEl.id) wrapper.dataset.for = selectEl.id;

    // Propagate sibling-targeting classes from the select to the wrapper so
    // parent CSS rules (e.g. `.advanced-filters > .secondary-filter`) keep
    // matching after the select is nested inside the wrapper.
    const PROPAGATED_CLASSES = ['secondary-filter'];
    PROPAGATED_CLASSES.forEach(cls => {
        if (selectEl.classList.contains(cls)) wrapper.classList.add(cls);
    });

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger filter-select';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (selectEl.disabled) trigger.disabled = true;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'custom-select-label';

    const chevron = document.createElement('span');
    chevron.className = 'custom-select-chevron';
    chevron.textContent = '▾';

    trigger.appendChild(labelSpan);
    trigger.appendChild(chevron);

    const menu = document.createElement('div');
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');

    function renderOptions() {
        menu.innerHTML = '';
        Array.from(selectEl.options).forEach(opt => {
            const item = document.createElement('div');
            item.className = 'custom-select-option';
            item.setAttribute('role', 'option');
            item.dataset.value = opt.value;
            item.textContent = opt.textContent;
            if (opt.value === selectEl.value) {
                item.classList.add('selected');
                item.setAttribute('aria-selected', 'true');
            }
            item.addEventListener('click', () => {
                if (opt.value !== selectEl.value) {
                    VALUE_DESCRIPTOR.set.call(selectEl, opt.value);
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
                }
                refreshUI();
                close();
            });
            menu.appendChild(item);
        });
    }

    function refreshUI() {
        const idx = selectEl.selectedIndex;
        const opt = idx >= 0 ? selectEl.options[idx] : null;
        labelSpan.textContent = opt ? opt.textContent : (selectEl.getAttribute('placeholder') || '');
        menu.querySelectorAll('.custom-select-option').forEach(el => {
            const selected = el.dataset.value === selectEl.value;
            el.classList.toggle('selected', selected);
            if (selected) el.setAttribute('aria-selected', 'true');
            else el.removeAttribute('aria-selected');
        });
    }

    let isOpen = false;
    function open() {
        if (isOpen || trigger.disabled) return;
        // Close any other open custom selects first.
        document.querySelectorAll('.custom-select.open').forEach(el => {
            if (el !== wrapper) el.classList.remove('open');
        });
        isOpen = true;
        wrapper.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onDocClick, true);
        document.addEventListener('keydown', onKey);
    }
    function close() {
        if (!isOpen) return;
        isOpen = false;
        wrapper.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onKey);
    }
    function onDocClick(e) {
        if (!wrapper.contains(e.target)) close();
    }
    function onKey(e) {
        if (e.key === 'Escape') {
            e.stopPropagation();
            close();
            trigger.focus();
        }
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        isOpen ? close() : open();
    });

    // Insert wrapper before select, then move select inside (hidden) along with trigger + menu.
    selectEl.parentNode.insertBefore(wrapper, selectEl);
    wrapper.appendChild(selectEl);
    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);

    // Monkey-patch this instance's `value` setter so external `select.value = X`
    // refreshes the visible label.
    Object.defineProperty(selectEl, 'value', {
        configurable: true,
        get() { return VALUE_DESCRIPTOR.get.call(this); },
        set(v) {
            VALUE_DESCRIPTOR.set.call(this, v);
            // Microtask: callers often set value, then immediately read it.
            queueMicrotask(refreshUI);
        }
    });

    // Watch for <option> list changes (e.g. populateFilters re-fills years/genres).
    const observer = new MutationObserver(() => {
        renderOptions();
        refreshUI();
    });
    observer.observe(selectEl, { childList: true, subtree: true });

    // Also expose an explicit refresh hook for edge cases.
    selectEl._customSelectRefresh = () => { renderOptions(); refreshUI(); };

    renderOptions();
    refreshUI();
}

export function enhanceAllSelects(scope = document) {
    scope.querySelectorAll('select.filter-select').forEach(enhanceSelect);
}
