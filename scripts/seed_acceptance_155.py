"""Create an isolated 1/1/3/60 acceptance environment; never seed the business root."""
import argparse
import os
from pathlib import Path
import yaml
import shutil

from seed_demo_data import (upsert_user, get_or_create_school, get_or_create_class,
                            ensure_student, ensure_teacher_links, new_id)
from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect, init_platform_db
from solaire.web.app import ensure_project_layout
from solaire.web.bank_service import save_question
from solaire.web.paper_service import sync_paper_for_exam, publish_online_paper
from solaire.web.student_service import start_student_publication, submit_student_attempt
from solaire.common.actor_context import actor
from solaire.common.answer_logic import encode
from solaire.exam_compiler.models import QuestionItem, ExamConfig, SelectedSection
from solaire.web.exam_workspace_service import workspace_dir


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-root', required=True)
    root = Path(parser.parse_args().data_root).resolve()
    marker = root / '.eh-acceptance-155'
    if root.exists() and any(root.iterdir()) and not marker.exists():
        raise SystemExit('Refusing to overwrite a non-acceptance data directory')
    root.mkdir(parents=True, exist_ok=True)
    marker.write_text('Isolated synthetic acceptance data, not real student records', encoding='utf-8')
    from solaire.agent_layer.llm.user_llm_overrides import load_user_overrides_raw, save_user_overrides_raw, user_overrides_path
    existing_ai = load_user_overrides_raw()
    os.environ['SOLAIRE_USER_CONFIG_DIR'] = str(root / 'config')
    if existing_ai and not user_overrides_path().exists():
        save_user_overrides_raw(existing_ai)
    os.environ['EH_DATA_ROOT'] = str(root)
    platform = root / 'platform'
    project = root / 'workspace'
    init_platform_db(platform)
    ensure_project_layout(project)
    template_source = Path(__file__).resolve().parents[1] / 'src' / 'solaire' / 'web' / 'bundled_project_templates' / 'math' / 'templates'
    for source in template_source.iterdir():
        destination = project / 'templates' / source.name
        if source.is_file() and not destination.exists():
            shutil.copy2(source, destination)
    for mode, second_type in [('choice', 'multiple_choice'), ('mixed', 'short_answer')]:
        template = {'template_id':f'acceptance-{mode}', 'layout':'single_column', 'latex_base':'exam-zh-base.tex.j2',
                    'sections':[{'section_id':'单选题','type':'single_choice','required_count':1,'score_per_item':50},
                                {'section_id':'综合题','type':second_type,'required_count':1,'score_per_item':50}], 'metadata_defaults':{}}
        destination = project / 'templates' / f'acceptance-{mode}.yaml'
        if not destination.exists():
            destination.write_text(yaml.safe_dump(template, allow_unicode=True), encoding='utf-8')
    school = get_or_create_school(platform)
    school_id = str(school['id'])
    klass = get_or_create_class(platform, school_id)
    class_ids = [str(klass['id'])]
    now = utc_now()
    with connect(platform) as con:
        for index in (2, 3):
            name = f'验收{index}班'
            row = con.execute('SELECT id FROM classes WHERE school_id=? AND name=?', (school_id, name)).fetchone()
            cid = str(row['id']) if row else new_id()
            if not row:
                con.execute('INSERT INTO classes(id,school_id,name,grade,created_at,updated_at) VALUES(?,?,?,?,?,?)', (cid,school_id,name,'G10',now,now))
            class_ids.append(cid)
    password = 'EHtest155!'
    accounts = [('eh_admin', 'admin', '验收管理员'), ('eh_school', 'school', '验收学校管理员')]
    teachers, students = [], []
    for username, role, name in accounts:
        upsert_user(platform, username=username, password=password, role=role, display_name=name, school_id=school_id if role != 'admin' else None, must_change_password=False)
    for index in range(1, 4):
        username = f'eh_teacher{index}'
        teacher = upsert_user(platform, username=username, password=password, role='teacher', display_name=f'验收教师{index}', school_id=school_id, must_change_password=False)
        for cid in class_ids:
            ensure_teacher_links(platform, school_id=school_id, teacher_id=str(teacher['id']), class_id=cid)
        teachers.append(teacher)
        accounts.append((username, 'teacher', f'验收教师{index}'))
    for index in range(1, 61):
        username = f'eh_student{index:02d}'
        name = f'验收学生{index:02d}'
        user = upsert_user(platform, username=username, password=password, role='student', display_name=name, school_id=school_id, must_change_password=False)
        ensure_student(platform, school_id=school_id, class_id=class_ids[(index-1)//20], user_id=str(user['id']), student_no=f'S{index:03d}', display_name=name, initial_password=password)
        students.append(user)
        accounts.append((username, 'student', name))
    for index, teacher in enumerate(teachers, 1):
        token = actor.set(teacher)
        try:
            questions = [
                QuestionItem(id='q1', type='single_choice', content=f'教师{index}专属题：1+1=?', options={'A':'2','B':'3'}, answer='A', analysis='1+1=2'),
                QuestionItem(id='q2', type='multiple_choice', content='哪些数字是偶数？', options={'A':'2','B':'3','C':'4'}, answer='AC', analysis='2和4都是偶数'),
                QuestionItem(id='q3', type='short_answer', content='给出a，或同时给出b和c。', answer=encode({'op':'or','items':[{'op':'value','value':'a'},{'op':'and','items':[{'op':'value','value':'b'},{'op':'value','value':'c'}]}]}), analysis='a与(b且c)为两个可接受的替代答案。'),
            ]
            for question in questions:
                save_question(project, f'math/default/{question.id}', question)
            for mode, selected in [('choice', ['q1','q2']), ('mixed', ['q1','q3'])]:
                exam_id = f'acceptance-teacher{index}-{mode}/Math'
                directory = workspace_dir(project, exam_id)
                directory.mkdir(parents=True, exist_ok=True)
                exam = ExamConfig(exam_id=exam_id, template_ref=f'acceptance-{mode}', template_path=f'templates/acceptance-{mode}.yaml', metadata={'title':f'验收教师{index}·{mode}','subject':'Math','export_label':f'acceptance-teacher{index}-{mode}'}, question_libraries=[], selected_items=[SelectedSection(section_id='单选题', question_ids=[f'math/default/{selected[0]}'], score_per_item=50), SelectedSection(section_id='综合题', question_ids=[f'math/default/{selected[1]}'], score_per_item=50)])
                (directory / 'exam.yaml').write_text(yaml.safe_dump(exam.model_dump(mode='json'), allow_unicode=True, sort_keys=False), encoding='utf-8')
                paper = sync_paper_for_exam(project, platform, teacher, exam_id=exam_id)
                with connect(platform) as con:
                    existing = con.execute('SELECT id FROM exam_publications WHERE paper_id=?', (paper['paper_id'],)).fetchone()
                if existing:
                    continue
                publication = publish_online_paper(platform, paper_id=paper['paper_id'], user=teacher, class_ids=class_ids, project_root=project, submission_mode='online')
                for student in students[:3]:
                    context = actor.set(student)
                    try:
                        started = start_student_publication(platform, project, publication_id=publication['id'], user=student)
                        submit_student_attempt(platform, project, attempt_id=started['attempt']['id'], user=student, answers=[{'question_id':f'math/default/{qid}', 'answer': 'A' if qid == 'q1' else 'AC' if qid == 'q2' else 'a'} for qid in selected])
                    finally:
                        actor.reset(context)
        finally:
            actor.reset(token)
    lines = ['# 1.5.5 本地验收账号', '', '仅限隔离验收环境；数据为合成样例，不是真实学生成绩。', '', '| 用户名 | 角色 | 密码 |', '|---|---|---|']
    lines.extend(f'| {username} | {role} | {password} |' for username, role, _ in accounts)
    (root / '测试账号.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'Created {len(accounts)} accounts; data root: {root}')


if __name__ == '__main__':
    main()
