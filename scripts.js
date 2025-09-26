function hex(x, pad = 8) {
    return '0x' + x.toString(16).toUpperCase().padStart(pad, '0');
}

function toUint32BE(bytes) {
    return (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | (bytes[3]);
}

const fileInput = document.getElementById('file');
const elfResultDiv = document.getElementById('elfResult');
const mipsResultDiv = document.getElementById('mipsResult');
const mipsTextarea = document.getElementById('mipsBlock');

function isValidElfFilename(filename) {
    const pattern = /^(SLUS|SLES)_[0-9]+\.[0-9]{2}$/i;
    return pattern.test(filename);
}

function resetElfUI() {
    fileInput.value = "";
    elfResultDiv.style.display = 'none';
    const elfStep2Header = document.getElementById('elfStep2Header');
    if (elfStep2Header) elfStep2Header.style.display = 'none';
    const step3 = document.getElementById('step3');
    if (step3) step3.style.display = 'none';
    const exampleBtn = document.querySelector('.example-toggle');
    if (exampleBtn) exampleBtn.style.display = 'none';
}

if (fileInput && elfResultDiv) {
    fileInput.addEventListener('change', () => {
        const f = fileInput.files[0];
        if (!f) return;

        if (!isValidElfFilename(f.name)) {
            alert("Invalid file name!\nExpected something like SLUS_214.90 or SLES_123.45.");
            resetElfUI();
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const view = new Uint8Array(reader.result);
            if (view.length < 0x1C) { alert('File too small'); return; }

            const bytes = [view[0x18], view[0x19], view[0x1A], view[0x1B]];
            const be = toUint32BE(bytes);
            const base = 0x20000000;
            const mapped = (base + be) >>> 0;
            const reversedHex = bytes.slice().reverse().map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');

            const out = [];
            out.push(`<div><strong>ELF bytes @0x18:</strong> <code>${bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}</code></div>`);
            out.push(`<div><strong>Load address:</strong> <code>${hex(be)}</code></div>`);
            out.push(`<div><strong>Mapped PCSX2 EE RAM address:</strong> 
                <code style="color:white">${hex(mapped)}</code>
                <em>This is the ELF load address in the BIOS/system region.</em>
                <button class="copy" data-text="${reversedHex}">Copy</button></div>`);

            elfResultDiv.innerHTML = out.join('');
            elfResultDiv.style.display = 'block';

            const elfStep2Header = document.getElementById('elfStep2Header');
            if (elfStep2Header) elfStep2Header.style.display = 'block';

            const step3 = document.getElementById('step3');
            if (step3) step3.style.display = 'block';

            const exampleBtn = document.querySelector('.example-toggle');
            if (exampleBtn) exampleBtn.style.display = 'inline-block';
        };
        reader.readAsArrayBuffer(f);
    });
}


if (mipsTextarea && mipsResultDiv) {
    function computeDynamicBase(mipsText) {
        const lines = mipsText.split('\n').map(l => l.trim());
        let upper = null, lower = null, dynamicBase = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            const matchLUI = line.match(/lui\s+a0,0x([0-9A-Fa-f]{1,4})/i);
            if (matchLUI) upper = parseInt(matchLUI[1], 16);

            const matchADDIU = line.match(/addiu\s+a0,a0,(-?0x[0-9A-Fa-f]+)/i);
            if (matchADDIU) lower = parseInt(matchADDIU[1], 16);

            if (line.toLowerCase().includes('syscall')) {
                const prevLine = lines[i - 1] || '';
                const v1Match = prevLine.match(/addiu\s+v1,zero,0x([0-9A-Fa-f]{1,2})/i);
                if (v1Match && parseInt(v1Match[1], 16) === 0x3C && upper !== null && lower !== null) {
                    dynamicBase = (upper << 16) + lower;
                    break;
                }
            }
        }

        return { dynamicBase, upper, lower };
    }


    mipsTextarea.addEventListener('input', () => {
        const { dynamicBase, upper, lower } = computeDynamicBase(mipsTextarea.value);
        const explanationContent = document.querySelector('.explanation-content');
        const explanationBtn = document.querySelector('.explanation-toggle');
        const mipsText = mipsTextarea.value;

        if (mipsText.trim().length > 0) {
            explanationBtn.style.display = 'inline-block';
        } else {
            explanationBtn.style.display = 'none';
            explanationContent.innerHTML = '';
        }

        if (dynamicBase !== null) {
            const isHeap = (dynamicBase >= 0x00100000 && dynamicBase <= 0x01FFFFFF);
            mipsResultDiv.innerHTML = `<div><strong>Computed dynamic memory base:</strong> 
                <code style="color:${isHeap ? '#00FF00' : 'red'}">${hex(dynamicBase)}</code> 
                ${isHeap ? '<em>is the start of dynamic memory (heap)</em>' : '<em>Possibly BIOS/system region</em>'}</div>`;
            mipsResultDiv.style.display = 'block';

            let explanation = `
<h3>Instruction breakdown (heap initialization):</h3>
<ul>
<li><code style="color:#E055E0">lui a0,0x${upper.toString(16).toUpperCase()}</code>: Loads the upper 16 bits of the heap base into <code>a0</code>.</li>
<li><code style="color:#E055E0">addiu a0,a0,0x${lower.toString(16).toUpperCase()}</code>: Adds the lower 16 bits to <code>a0</code>, producing the full 32-bit dynamic memory base.</li>
<li><code style="color:#E055E0">or gp,a0,zero</code>: Stores the heap base into the global pointer <code>gp</code>, Not so imporant here.</li>
<li><code style="color:#E055E0">addiu v1,zero,0x3C</code> followed by <code style="color:#E055E0">syscall</code>: System call 0x3C reserves the heap at <code style="color:lime">${hex(dynamicBase)}</code>. <strong>This sets the actual start of dynamic memory (heap).</strong></li>
<li><code style="color:#E055E0">or sp,v0,zero</code>: Sets up the stack pointer <code>sp</code> relative to the heap. Also irrelevant. </li>
<li><strong>Computed dynamic memory base:</strong> (0x${upper.toString(16).toUpperCase()} << 16) + 0x${lower.toString(16).toUpperCase()} = <code style="color:lime">${hex(dynamicBase)}</code></li>
</ul>
`;

            const secondBlockMatch = mipsText.match(/(?:syscall\s*---\s*\n)([\s\S]*?addiu v1,zero,0x3D[\s\S]*?syscall\s*---)/i);
            let secondBase = null;

            if (secondBlockMatch) {
                const secondBlock = secondBlockMatch[1]
                    .split("\n")
                    .map(line => `<code style="color:#E055E0">${line.trim()}</code>`)
                    .join("\n");

                const luiMatch = secondBlockMatch[1].match(/lui a0,0x([0-9A-Fa-f]+)/i);
                const addiuMatch = secondBlockMatch[1].match(/addiu a0,a0,(-?0x[0-9A-Fa-f]+)/i);

                if (luiMatch && addiuMatch) {
                    const upper2 = parseInt(luiMatch[1], 16);
                    const lower2 = parseInt(addiuMatch[1], 16);
                    secondBase = (upper2 << 16) + lower2;
                }

                explanation += `
<h4>Other system allocations (syscall 0x3D)</h4>
<p>The following instructions allocate memory for <strong>system or BIOS structures</strong> and doesn't change the dynamic memory start:</p>
<pre style="background:#1B1B1B;padding:10px;border-radius:6px;overflow-x:auto;">${secondBlock}</pre>
<p><strong>Note:</strong> Syscall <code>0x3D</code> typically sets up additional memory blocks at <code style="color:lime">${secondBase ? hex(secondBase) : 'unknown'}</code>, but the dynamic heap base remains the address set by the first syscall (0x3C).</p>
`;
            }

            explanation += `
<p><strong>Memory mapping context:</strong> PS2 EE RAM ranges from 0x00100000 to 0x01FFFFFF.</p>
<ul>
<li>First syscall <code>0x3C</code> → dynamic memory heap start (<code>${hex(dynamicBase)}</code>).</li>
<li>Later syscalls <code>0x3D</code> → allocate system structures or BIOS shadow memory${secondBase ? ` at <code>${hex(secondBase)}</code>` : ''}, without changing the heap start.</li>
</ul>
`;

            explanationContent.innerHTML = explanation;
        } else {
            mipsResultDiv.style.display = 'none';
            explanationContent.innerHTML = '';
        }
    });
}

document.addEventListener('click', e => {
    if (e.target.classList.contains('example-toggle')) {
        const wrapper = e.target.nextElementSibling;
        wrapper.classList.toggle('show');
        e.target.textContent = wrapper.classList.contains('show')
            ? 'Hide example instructions'
            : 'Show example instructions';
    }

    if (e.target.classList.contains('explanation-toggle')) {
        const wrapper = e.target.nextElementSibling;
        if (!wrapper.classList.contains('show')) {
            wrapper.style.maxHeight = wrapper.scrollHeight + "px";
            wrapper.classList.add('show');
            e.target.textContent = 'Hide Memory Analysis';
        } else {
            wrapper.style.maxHeight = wrapper.scrollHeight + "px";
            requestAnimationFrame(() => { wrapper.style.maxHeight = "0px"; });
            wrapper.classList.remove('show');
            e.target.textContent = 'Show Memory Analysis';
        }
    }

    if (e.target.classList.contains('copy')) {
        const text = e.target.dataset.text;
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                e.target.textContent = 'Copied';
                setTimeout(() => e.target.textContent = 'Copy', 900);
            }).catch(() => fallbackCopy(text, e.target));
        } else fallbackCopy(text, e.target);
    }
});

function fallbackCopy(text, btn) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = 0;
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        btn.textContent = 'Copied';
        setTimeout(() => btn.textContent = 'Copy', 900);
    } catch (err) {
        alert('Copy failed: ' + err);
    }
    document.body.removeChild(textarea);
}