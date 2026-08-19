import { useState } from 'react';
import { Card, Form, Input, Button, Tabs, Typography, App as AntApp } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { api, tokenStore } from './api';

const { Title, Text } = Typography;

interface LoginPageProps {
  onSuccess: (username: string) => void;
}

export function LoginPage({ onSuccess }: LoginPageProps) {
  const [loading, setLoading] = useState(false);
  const { message } = AntApp.useApp();

  const handleLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const { token, user } = await api.login(values.username, values.password);
      tokenStore.set(token);
      message.success(`欢迎回来，${user.username}`);
      onSuccess(user.username);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const { token, user } = await api.register(values.username, values.password);
      tokenStore.set(token);
      message.success(`注册成功，欢迎 ${user.username}`);
      onSuccess(user.username);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const formItems = (
    <>
      <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
        <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
      </Form.Item>
      <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
        <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
      </Form.Item>
    </>
  );

  return (
    <div className="login-page">
      <Card className="login-card" bordered={false}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ margin: 0 }}>提示词收藏</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>文生图 · 文生视频 · 图生视频</Text>
        </div>
        <Tabs
          centered
          items={[
            {
              key: 'login',
              label: '登录',
              children: (
                <Form onFinish={handleLogin} size="large">
                  {formItems}
                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button type="primary" htmlType="submit" block loading={loading}>
                      登录
                    </Button>
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: 'register',
              label: '注册',
              children: (
                <Form onFinish={handleRegister} size="large">
                  {formItems}
                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button type="primary" htmlType="submit" block loading={loading}>
                      注册
                    </Button>
                  </Form.Item>
                </Form>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
