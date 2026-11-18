import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
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
                      child: TextField(
                        controller: fields[key],
                        inputFormatters: key == 'chineseName'
                            ? null
                            : [UppercaseInput()],
                        decoration: InputDecoration(labelText: label),
                      ),
                    ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    initialValue: profile['gender'],
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: '性别'),
                    items: ['', '男', '女']
                        .map(
                          (value) => DropdownMenuItem(
                            value: value,
                            child: Text(value.isEmpty ? '未设置' : value),
                          ),
                        )
                        .toList(),
                    onChanged: (value) => profile['gender'] = value,
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
                          DropdownButtonFormField<String>(
                            initialValue: doc.type,
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: '证件类型',
                            ),
                            items: documentTypes.entries
                                .map(
                                  (entry) => DropdownMenuItem(
                                    value: entry.key,
                                    child: Text(entry.value),
                                  ),
                                )
                                .toList(),
                            onChanged: (value) =>
                                setState(() => doc.type = value!),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: doc.number,
                            inputFormatters: [UppercaseInput()],
                            decoration: const InputDecoration(
                              labelText: '证件号码',
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: doc.label,
                            decoration: const InputDecoration(
                              labelText: '证件备注名',
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
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
                      child: DropdownButtonFormField<String>(
                        key: ValueKey('$key:${profile[key]}:${docs.length}'),
                        initialValue: profile[key],
                        isExpanded: true,
                        decoration: InputDecoration(labelText: label),
                        items: [
                          const DropdownMenuItem(
                            value: '',
                            child: Text('按证件类型自动选择'),
                          ),
                          const DropdownMenuItem(
                            value: 'none',
                            child: Text('不自动填写证件'),
                          ),
                          for (final doc in docs)
                            DropdownMenuItem(
                              value: doc.id,
                              child: Text(
                                doc.label.text.isEmpty
                                    ? documentTypes[doc.type]!
                                    : doc.label.text,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                        ],
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
