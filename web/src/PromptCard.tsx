import { useState } from 'react';
import { Card, Tag, Button, Tooltip, Space, Typography, Popconfirm } from 'antd';
import {
  StarFilled,
  StarOutlined,
  EditOutlined,
  DeleteOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import type { Model, ModelRef, Prompt, Source, Tag as TagType } from './api';
import { copyText, formatDateTime, TYPE_LABELS } from './utils';
import './app.css';

const { Text, Paragraph, Title } = Typography;

const TYPE_COLOR: Record<string, string> = {
  t2i: 'purple',
  t2v: 'blue',
  i2v: 'orange',
};

const SOURCE_COLOR = 'green';

const REF_TYPE_COLOR: Record<string, string> = {
  lora: 'magenta',
  checkpoint: 'gold',
};

interface Props {
  prompt: Prompt;
  tagMap: Record<number, TagType>;
  modelMap: Record<number, Model>;
  modelRefMap: Record<number, ModelRef>;
  sourceMap: Record<number, Source>;
  onEdit: (prompt: Prompt) => void;
  onDelete: (prompt: Prompt) => void;
  onToggleFavorite: (prompt: Prompt) => void;
}

export function PromptCard({ prompt, tagMap, modelMap, modelRefMap, sourceMap, onEdit, onDelete, onToggleFavorite }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (await copyText(prompt.content)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const tagNames = prompt.tags.map((id) => tagMap[id]?.name).filter(Boolean) as string[];
  const modelName = prompt.model_id != null ? modelMap[prompt.model_id]?.name : undefined;
  const modelRefTags = prompt.model_refs
    .map((id) => modelRefMap[id])
    .filter(Boolean) as ModelRef[];
  const sourceName = prompt.source_id != null ? sourceMap[prompt.source_id]?.name : undefined;

  return (
    <Card className="prompt-card" size="small">
      <div className="card-head">
        <Space size={4} wrap>
          <Tag color={TYPE_COLOR[prompt.type]}>{TYPE_LABELS[prompt.type]}</Tag>
          {sourceName && <Tag color={SOURCE_COLOR}>{sourceName}</Tag>}
        </Space>
        <Title level={5} ellipsis style={{ flex: 1, margin: 0 }} title={prompt.title}>
          {prompt.title}
        </Title>
        <Tooltip title={prompt.favorite ? '取消收藏' : '收藏'}>
          <Button
            type="text"
            size="small"
            icon={
              prompt.favorite ? (
                <StarFilled style={{ color: '#f5a623' }} />
              ) : (
                <StarOutlined style={{ color: '#d1d5db' }} />
              )
            }
            onClick={() => onToggleFavorite(prompt)}
          />
        </Tooltip>
      </div>

      <Tooltip title={copied ? '已复制' : '点击复制'} mouseEnterDelay={0.2}>
        <pre className="card-content clamp card-content-copy" onClick={handleCopy}>
          {prompt.content}
        </pre>
      </Tooltip>

      <div className="card-meta">
        {modelName && (
          <Space size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>模型：</Text>
            <Text style={{ fontSize: 12 }} title={modelName}>{modelName}</Text>
          </Space>
        )}
        {tagNames.length > 0 && (
          <Space size={4} wrap>
            {tagNames.map((name) => (
              <Tag key={name} color="blue" style={{ margin: 0 }}>
                {name}
              </Tag>
            ))}
          </Space>
        )}
        {modelRefTags.length > 0 && (
          <div style={{ width: '100%' }}>
            <Space size={4} wrap>
              {modelRefTags.map((ref) => (
                <Tag
                  key={ref.id}
                  color={REF_TYPE_COLOR[ref.ref_type]}
                  style={{
                    margin: 0,
                    cursor: ref.url ? 'pointer' : 'default',
                  }}
                  title={
                    ref.url
                      ? `${ref.download_name || ref.name} · ${ref.ref_type === 'lora' ? 'LoRA' : 'Checkpoint'} · 点击打开链接`
                      : `${ref.download_name || ref.name} · ${ref.ref_type === 'lora' ? 'LoRA' : 'Checkpoint'}`
                  }
                  onClick={() => {
                    if (ref.url) window.open(ref.url, '_blank', 'noopener,noreferrer');
                  }}
                >
                  {ref.url && <LinkOutlined style={{ marginRight: 2 }} />}
                  {ref.download_name || ref.name}
                </Tag>
              ))}
            </Space>
          </div>
        )}
      </div>

      {prompt.note && (
        <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>备注 </Text>
          {prompt.note}
        </Paragraph>
      )}

      <div className="card-foot">
        <Text type="secondary" style={{ fontSize: 12 }}>{formatDateTime(prompt.created_at)}</Text>
        <Space size={4}>
          {prompt.url && (
            <Tooltip title={prompt.url}>
              <Button
                size="small"
                icon={<LinkOutlined />}
                onClick={() => window.open(prompt.url, '_blank', 'noopener,noreferrer')}
              />
            </Tooltip>
          )}
          <Tooltip title="编辑">
            <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(prompt)} />
          </Tooltip>
          <Popconfirm
            title="删除提示词"
            description={`确定删除「${prompt.title}」吗？删除后不可恢复。`}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => onDelete(prompt)}
          >
            <Tooltip title="删除">
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      </div>
    </Card>
  );
}
