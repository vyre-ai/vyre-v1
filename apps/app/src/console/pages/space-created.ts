const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A moment as a person reads it: "8 Apr 2026, 11:16". Day, short month, year, then the 24 hour time without seconds, in the person's time zone (the device's when none is given). */
export function createdLine(at: number | string | Date, timeZone?: string): string {
    const date = new Date(at);
    if (Number.isNaN(date.getTime()))
        return 'Unknown';
    let parts: Intl.DateTimeFormatPart[];
    try {
        parts = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) }).formatToParts(date);
    }
    catch {
        parts = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).formatToParts(date);
    }
    const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${Number(get('day'))} ${MONTHS[Number(get('month')) - 1] ?? ''} ${get('year')}, ${hour}:${get('minute')}`;
}
