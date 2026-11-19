import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'archive_choice_field.dart';
import 'archive_text_field.dart';
import 'design.dart';
import 'input_formatters.dart';
import 'sync_review.dart';

Future<void> openProfileEditor(BuildContext context, AppStore store) async {
  if (!await checkArchiveWrite(context, store) || !context.mounted) return;
  await Navigator.of(context)
      .push(MaterialPageRoute(builder: (_) => ProfileEditor(store)));
}

class ProfileEditor extends StatefulWidget {
  final AppStore store;
  const ProfileEditor(this.store, {super.key});
  @override
  State<ProfileEditor> createState() => _ProfileEditorState();
}

class _ProfileEditorState extends State<ProfileEditor> {
  late final original = personalProfile(
    widget.store.settings['profile'] as Map? ?? {},
  );
  late final profile = personalProfile(original);
  final fields = <String, TextEditingController>{}, docs = <_DocumentDraft>[];
  bool saving = false;
  @override
  void initState() {
    super.initState();
    for (final key in ['chineseName', 'lastName', 'firstName']) {
      fields[key] = TextEditingController(text: profile[key]);
    }
    for (final doc in profile['documents']) {
      docs.add(_DocumentDraft(doc));
    }
  }

  @override
  void dispose() {
    for (final field in fields.values) {
      field.dispose();
    }
    for (final doc in docs) {
      doc.dispose();
    }
    super.dispose();
  }

  Future<void> save() async {
    setState(() => saving = true);
    try {
      await widget.store.saveProfile(
        {
          ...profile,
          for (final entry in fields.entries) entry.key: entry.value.text,
          'documents': docs.map((doc) => doc.value).toList(),
        },
        original: original,
        pick: pickSyncConflicts(context),
      );
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) showError(context, error);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.store,
    builder: (context, _) => _buildProfile(context),
  );

  Widget _buildProfile(BuildContext context) => PopScope(
    canPop: !saving,
    child: Scaffold(
      appBar: AppBar(title: const Text('个人资料')),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: FilledButton.icon(
            onPressed: saving || !widget.store.canWrite ? null : save,
            icon: saving
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.check),
            label: Text(saving ? '正在保存…' : '保存个人资料'),
          ),
        ),
      ),
      body: ArchiveEditControls(
        enabled: widget.store.canWrite,
        busy: saving,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (widget.store.readOnlyReason case final reason?)
                    Text(reason),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('录入时自动填写旅客资料'),
                    value: profile['autoFill'],
                    onChanged: (value) =>
                        setState(() => profile['autoFill'] = value),
                  ),
                  for (final (key, label) in [
                    ('chineseName', '中文姓名'),
                    ('lastName', '英文姓（Last name）'),
                    ('firstName', '英文名（First name）'),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(top: 16),
                      child: ArchiveTextField(
                        controller: fields[key]!,
                        inputFormatters: key == 'chineseName'
                            ? null
                            : [UppercaseInput()],
                        decoration: InputDecoration(labelText: label),
                      ),
                    ),
                  const SizedBox(height: 16),
                  ArchiveChoiceField<String>(
                    label: '性别',
                    value: profile['gender'],
                    choices: const {'': '未设置', '男': '男', '女': '女'},
                    onChanged: (value) =>
                        setState(() => profile['gender'] = value),
                  ),
                  const SectionTitle('常用证件'),
                  for (final doc in docs)
                    Padding(
                      key: ValueKey(doc.id),
                      padding: const EdgeInsets.only(bottom: 24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  '证件 ${docs.indexOf(doc) + 1}',
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleMedium,
                                ),
                              ),
                              TextButton(
                                onPressed: () => setState(() {
                                  for (final key in [
                                    'railDocument',
                                    'flightDocument',
                                  ]) {
                                    if (profile[key] == doc.id) {
                                      profile[key] = '';
                                    }
                                  }
                                  docs.remove(doc);
                                  doc.dispose();
                                }),
                                child: const Text('移除'),
                              ),
                            ],
                          ),
                          ArchiveChoiceField<String>(
                            label: '证件类型',
                            value: doc.type,
                            choices: documentTypes,
                            onChanged: (value) =>
                                setState(() => doc.type = value),
                          ),
                          const SizedBox(height: 12),
                          _DocumentNumberField(
                            number: doc.number,
                            nationalId: doc.type == 'national-id',
                          ),
                          const SizedBox(height: 12),
                          ArchiveTextField(
                            controller: doc.label,
                            decoration: const InputDecoration(
                              labelText: '证件备注名',
                            ),
                          ),
                          const SizedBox(height: 12),
                          ArchiveTextField(
                            controller: doc.expiry,
                            readOnly: true,
                            decoration: InputDecoration(
                              labelText: '有效期至',
                              suffixIcon: IconButton(
                                tooltip: '清除有效期',
                                onPressed: () => doc.expiry.clear(),
                                icon: const Icon(Icons.close),
                              ),
                            ),
                            onTap: () async {
                              final date = await showDatePicker(
                                context: context,
                                initialDate:
                                    DateTime.tryParse(doc.expiry.text) ??
                                    DateTime.now(),
                                firstDate: DateTime(1800),
                                lastDate: DateTime(2200),
                              );
                              if (date != null) {
                                doc.expiry.text = JourneyDate.fromDateTime(date)
                                    .calendarText;
                              }
                            },
                          ),
                        ],
                      ),
                    ),
                  OutlinedButton.icon(
                    onPressed: docs.length >= 20
                        ? null
                        : () => setState(
                            () => docs.add(
                              _DocumentDraft({
                                'id': newTicketId(),
                                'type': 'national-id',
                              }),
                            ),
                          ),
                    icon: const Icon(Icons.add),
                    label: const Text('添加其他证件'),
                  ),
                  const SizedBox(height: 24),
                  for (final (key, label) in [
                    ('railDocument', '火车票默认证件'),
                    ('flightDocument', '机票默认证件'),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: ArchiveChoiceField<String>(
                        label: label,
                        value: profile[key],
                        choices: {
                          '': '按证件类型自动选择',
                          'none': '不自动填写证件',
                          for (final doc in docs)
                            doc.id: doc.label.text.isEmpty
                                ? documentTypes[doc.type]!
                                : doc.label.text,
                        },
                        onChanged: (value) =>
                            setState(() => profile[key] = value),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class _DocumentNumberField extends StatefulWidget {
  final TextEditingController number;
  final bool nationalId;
  const _DocumentNumberField({required this.number, required this.nationalId});

  @override
  State<_DocumentNumberField> createState() => _DocumentNumberFieldState();
}

class _DocumentNumberFieldState extends State<_DocumentNumberField> {
  final focus = FocusNode();
  final display = TextEditingController();

  @override
  void initState() {
    super.initState();
    focus.addListener(_refresh);
    _refresh();
  }

  @override
  void didUpdateWidget(_DocumentNumberField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.nationalId != widget.nationalId && !focus.hasFocus) {
      _refresh();
    }
  }

  void _refresh() {
    final number = widget.number.text;
    final text = focus.hasFocus
        ? number
        : maskRailIdentity(number, isNationalId: widget.nationalId);
    display.value = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }

  @override
  void dispose() {
    focus.dispose();
    display.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ArchiveTextField(
    controller: display,
    focusNode: focus,
    autocorrect: false,
    enableSuggestions: false,
    inputFormatters: [const CompleteIdentityInput(), UppercaseInput()],
    decoration: const InputDecoration(labelText: '证件号码'),
    onChanged: (value) => widget.number.text = value,
  );
}

class _DocumentDraft {
  final String id;
  String type;
  final TextEditingController number, label, expiry;
  _DocumentDraft(Map value)
    : id = value['id'],
      type = value['type'],
      number = TextEditingController(text: value['number'] ?? ''),
      label = TextEditingController(text: value['label'] ?? ''),
      expiry = TextEditingController(text: value['expiry'] ?? '');
  Map<String, dynamic> get value => {
    'id': id,
    'type': type,
    'number': number.text,
    'label': label.text,
    'expiry': expiry.text,
  };
  void dispose() {
    number.dispose();
    label.dispose();
    expiry.dispose();
  }
}
