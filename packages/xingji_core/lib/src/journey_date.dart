class JourneyDate implements Comparable<JourneyDate> {
  final int? year;
  final int? dayOfYear;
  const JourneyDate._(this.year, this.dayOfYear);
  factory JourneyDate(int? year, int? dayOfYear) {
    if (year != null && (year < 1800 || year > 2200))
      throw const FormatException('年份须为 1800 至 2200');
    if (dayOfYear != null &&
        (dayOfYear < 1 || dayOfYear > daysInYear(year ?? 2000)))
      throw const FormatException('年内天数与年份不符');
    return JourneyDate._(year, dayOfYear);
  }
  static int daysInYear(int year) =>
      year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) ? 366 : 365;
  factory JourneyDate.calendar(int year, int month, int day) {
    final date = DateTime.utc(year, month, day);
    if (date.year != year || date.month != month || date.day != day)
      throw const FormatException('日期无效');
    return JourneyDate(year, date.difference(DateTime.utc(year)).inDays + 1);
  }
  factory JourneyDate.fromDateTime(DateTime date) =>
      JourneyDate.calendar(date.year, date.month, date.day);
  static JourneyDate? fromJson(dynamic value) {
    if (value == null || value == '') return null;
    if (value is! Map ||
        value.keys.any((key) => !['year', 'dayOfYear'].contains(key)))
      throw const FormatException('日期记录格式无效');
    if (value['year'] != null && value['year'] is! int ||
        value['dayOfYear'] != null && value['dayOfYear'] is! int)
      throw const FormatException('日期记录格式无效');
    return JourneyDate(value['year'] as int?, value['dayOfYear'] as int?);
  }

  DateTime? get date => year != null && dayOfYear != null
      ? DateTime.utc(year!, 1, dayOfYear!)
      : null;
  bool get complete => date != null;
  String get calendarText => year == null
      ? ''
      : dayOfYear == null
      ? '$year'
      : '${year!}-${date!.month.toString().padLeft(2, '0')}-${date!.day.toString().padLeft(2, '0')}';
  String get label =>
      year == null ? '第 $dayOfYear 天（年份未知）' : calendarText.replaceAll('-', '.');
  Object toJson() => year == null && dayOfYear == null
      ? ''
      : {'year': year, 'dayOfYear': dayOfYear};
  @override
  int compareTo(JourneyDate other) =>
      calendarText.compareTo(other.calendarText);
}
